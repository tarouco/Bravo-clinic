import type { SavedCard } from '@bravo/core';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import { consents, paymentCustomers, savedCards, users } from '../../db/schema';
import { AppError, notFound } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { RequestMeta } from '../../lib/request-meta';
import { GatewayError, type ProviderId } from '../../payments/gateway';
import { activeProvider, resolveGateway } from '../../payments/resolver';
import type { PaymentDeps } from './charges.service';

export const RECURRING_CONSENT_VERSION = 'recurring-2026-10';

type CardRow = typeof savedCards.$inferSelect;

export const toSavedCard = (row: CardRow): SavedCard => ({
  id: row.id,
  brand: row.brand ?? 'card',
  last4: row.last4 ?? '0000',
  expMonth: row.expMonth ?? 1,
  expYear: row.expYear ?? 2000,
  recurringConsentAt: row.recurringConsentAt?.toISOString() ?? null,
});

/** The user's cards that can still be charged, newest first (also used by the balance job). */
export function listSavedCards(db: Db | Tx, userId: string): Promise<CardRow[]> {
  return db
    .select()
    .from(savedCards)
    .where(and(eq(savedCards.userId, userId), isNull(savedCards.deletedAt)))
    .orderBy(desc(savedCards.createdAt));
}

const gatewayError = (message: string) =>
  new AppError(502, 'GATEWAY_ERROR', 'Não foi possível salvar o cartão. Tente novamente.', {
    reason: message.slice(0, 200),
  });

/** The gateway customer of the user, created at the provider on first use (NUC-126). */
export async function ensureCustomer(
  deps: PaymentDeps,
  userId: string,
  provider: ProviderId,
): Promise<string> {
  const [existing] = await deps.db
    .select()
    .from(paymentCustomers)
    .where(and(eq(paymentCustomers.userId, userId), eq(paymentCustomers.provider, provider)));
  if (existing !== undefined) return existing.externalCustomerId;

  const [user] = await deps.db.select().from(users).where(eq(users.id, userId));
  if (user === undefined) throw notFound();
  if (user.docType === null || user.docNumber === null) {
    throw new AppError(
      422,
      'PROFILE_INCOMPLETE',
      'Complete seu cadastro com CPF ou CNPJ para reservar.',
    );
  }
  const gateway = await resolveGateway(provider, deps);
  let customerId: string;
  try {
    ({ customerId } = await gateway.ensureCustomer({
      userId,
      email: user.email,
      name: user.name,
      docType: user.docType as 'cpf' | 'cnpj',
      docNumber: user.docNumber,
    }));
  } catch (error) {
    if (error instanceof GatewayError) {
      logger.error('gateway customer failed', {
        provider,
        kind: error.kind,
        message: error.message,
      });
      throw gatewayError(error.message);
    }
    throw error;
  }
  await deps.db
    .insert(paymentCustomers)
    .values({ userId, provider, externalCustomerId: customerId })
    .onConflictDoNothing();
  // A concurrent request may have won the insert: the stored id is the one to use.
  const [stored] = await deps.db
    .select()
    .from(paymentCustomers)
    .where(and(eq(paymentCustomers.userId, userId), eq(paymentCustomers.provider, provider)));
  return stored?.externalCustomerId ?? customerId;
}

/**
 * `POST /app/cards` (NUC-126): saves a tokenized card with the explicit recurring-charge
 * consent. The token comes from the gateway's tokenizer; the API never sees the card number.
 */
export async function saveCard(
  deps: PaymentDeps,
  meta: RequestMeta,
  userId: string,
  cardToken: string,
): Promise<SavedCard> {
  const provider = await activeProvider(deps.db);
  const customerId = await ensureCustomer(deps, userId, provider);
  const gateway = await resolveGateway(provider, deps);
  let info;
  try {
    info = await gateway.saveCard({ customerId, cardToken });
  } catch (error) {
    if (error instanceof GatewayError) {
      logger.error('gateway save card failed', {
        provider,
        kind: error.kind,
        message: error.message,
      });
      throw gatewayError(error.message);
    }
    throw error;
  }
  const now = deps.now();
  return deps.db.transaction(async (tx) => {
    const [card] = await tx
      .insert(savedCards)
      .values({
        userId,
        provider,
        externalCardId: info.cardId,
        brand: info.brand,
        last4: info.last4,
        expMonth: info.expMonth,
        expYear: info.expYear,
        recurringConsentAt: now,
      })
      .onConflictDoUpdate({
        target: [savedCards.provider, savedCards.externalCardId],
        // The same physical card saved again by its owner is reactivated, never duplicated.
        set: {
          deletedAt: null,
          recurringConsentAt: now,
          brand: info.brand,
          last4: info.last4,
          expMonth: info.expMonth,
          expYear: info.expYear,
        },
        setWhere: sql`${savedCards.userId} = ${userId}`,
      })
      .returning();
    if (card === undefined) {
      throw new AppError(409, 'CONFLICT', 'Este cartão já está salvo em outra conta.');
    }
    await tx.insert(consents).values({
      userId,
      kind: 'recurring_charge',
      version: RECURRING_CONSENT_VERSION,
      acceptedAt: now,
      ip: meta.ip,
      userAgent: meta.userAgent,
      refType: 'saved_card',
      refId: card.id,
    });
    return toSavedCard(card);
  });
}

/** `DELETE /app/cards/:id` (NUC-127): soft delete; the card is never charged again. */
export async function deleteCard(
  db: Db | Tx,
  userId: string,
  cardId: string,
  now: Date,
): Promise<void> {
  const [row] = await db
    .update(savedCards)
    .set({ deletedAt: now })
    .where(
      and(eq(savedCards.id, cardId), eq(savedCards.userId, userId), isNull(savedCards.deletedAt)),
    )
    .returning({ id: savedCards.id });
  if (row === undefined) throw notFound('NOT_FOUND', 'Cartão não encontrado');
}

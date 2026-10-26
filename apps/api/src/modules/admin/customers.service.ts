import {
  DOCUMENT_MESSAGE,
  formatDocument,
  parseDocument,
  type CustomerCreateInput,
} from '@bravo/core';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { users } from '../../db/schema';
import { audit, type RequestContext } from '../../lib/audit';
import { dispatchEmails } from '../../lib/email';
import { conflict, uniqueViolationConstraint, validationFailed } from '../../lib/errors';
import { appUrl } from '../../lib/request-meta';
import { createAuthToken } from '../auth/auth-tokens';
import { bookingMailer } from '../booking/booking-mailer';
import type { PaymentDeps } from '../payments/charges.service';

const SET_PASSWORD_TTL_SECONDS = 72 * 3600;
const SEARCH_LIMIT = 20;

/** "***.***.***-25": only the last two digits of a CPF or CNPJ are shown. */
function maskDocument(type: string, digits: string): string {
  const formatted = formatDocument({ type: type as 'cpf' | 'cnpj', digits });
  let seen = 0;
  return formatted.replace(/\d/g, (digit) => {
    seen += 1;
    return seen > digits.length - 2 ? digit : '*';
  });
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * `GET /admin/customers/search` (NUC-169): active tenants matching name, e-mail or document
 * digits. The caller validates the 2-character minimum.
 */
export async function searchCustomers(db: Db, q: string) {
  const term = q.trim();
  const digits = term.replace(/\D/g, '');
  const pattern = `%${escapeLike(term)}%`;
  const rows = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.role, 'tenant'),
        eq(users.status, 'active'),
        isNull(users.deletedAt),
        or(
          sql`${users.name} ilike ${pattern}`,
          sql`${users.email} ilike ${pattern}`,
          digits.length >= 2 ? sql`${users.docNumber} like ${`%${digits}%`}` : undefined,
        ),
      ),
    )
    .orderBy(asc(users.name))
    .limit(SEARCH_LIMIT);
  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      docMasked:
        row.docType === null || row.docNumber === null
          ? null
          : maskDocument(row.docType, row.docNumber),
      phone: row.phone,
    })),
  };
}

/**
 * `POST /admin/customers` (NUC-169): a tenant made at the counter has a verified e-mail and no
 * password; the "create your password" e-mail carries a 72 h link.
 */
export async function createCustomer(
  deps: PaymentDeps,
  ctx: RequestContext,
  input: CustomerCreateInput,
): Promise<{ id: string; name: string; email: string }> {
  const document = parseDocument(input.document);
  if (document === null)
    throw validationFailed([{ path: ['document'], message: DOCUMENT_MESSAGE }]);
  const now = deps.now();
  let created;
  try {
    created = await deps.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          role: 'tenant',
          name: input.name,
          email: input.email,
          emailVerifiedAt: now,
          docType: document.type,
          docNumber: document.digits,
          phone: input.phone,
        })
        .returning();
      if (user === undefined) throw new Error('createCustomer: insert returned no row');
      const token = await createAuthToken(tx, {
        userId: user.id,
        purpose: 'password_reset',
        now,
        ttlSeconds: SET_PASSWORD_TTL_SECONDS,
      });
      const emailId = await bookingMailer.setPassword(tx, user, {
        link: appUrl(deps.env, `/redefinir-senha?token=${token}`),
      });
      await audit(tx, ctx, {
        action: 'customer.create',
        entityType: 'user',
        entityId: user.id,
        after: { name: user.name, email: user.email, docType: document.type },
      });
      return { user, emailId };
    });
  } catch (error) {
    const constraint = uniqueViolationConstraint(error);
    if (constraint === 'users_email_uq') throw conflict('EMAIL_TAKEN', 'E-mail já cadastrado');
    if (constraint === 'users_doc_uq')
      throw conflict('DOCUMENT_TAKEN', 'CPF ou CNPJ já cadastrado');
    throw error;
  }
  await dispatchEmails(deps.db, [created.emailId], { env: deps.env, fetch: deps.fetch });
  return { id: created.user.id, name: created.user.name, email: created.user.email };
}

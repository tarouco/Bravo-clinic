import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { webhookEvents } from '../../db/schema';
import type { RequestContext } from '../../lib/audit';
import { AppError, notFound, unauthorized } from '../../lib/errors';
import { GatewayError, isProviderId } from '../../payments/gateway';
import { resolveGateway } from '../../payments/resolver';
import type { PaymentDeps } from './charges.service';
import { SYSTEM_CONTEXT, applyProviderStatus } from './payment-effects.service';

export type WebhookResult = 'processed' | 'duplicate' | 'ignored';

/** An unprocessed event this old (or one that errored) may be processed again. */
const STALE_AFTER_MS = 2 * 60_000;
const MAX_ERROR_LENGTH = 500;

export interface IncomingWebhook {
  headers: Record<string, string>;
  rawBody: string;
  query: Record<string, string>;
}

/**
 * `POST /webhooks/pagamentos/:provider` (NUC-112, NUC-113): the adapter verifies the signature
 * before anything is stored (invalid: 401, nothing inserted), the event is deduplicated on
 * `(provider, external_id, external_status)` and then applied through `applyProviderStatus`.
 * Two concurrent deliveries process once; a delivery that crashed midway can be retried.
 */
export async function receivePaymentWebhook(
  deps: PaymentDeps,
  providerParam: string,
  request: IncomingWebhook,
  ctx: RequestContext = SYSTEM_CONTEXT,
): Promise<WebhookResult> {
  if (!isProviderId(providerParam)) throw notFound();
  const provider = providerParam;

  let gateway;
  try {
    gateway = await resolveGateway(provider, deps);
  } catch (error) {
    // A provider with no credentials cannot verify anything.
    if (error instanceof AppError && error.code === 'GATEWAY_NOT_CONFIGURED') {
      throw unauthorized('INVALID_SIGNATURE', 'Assinatura inválida');
    }
    throw error;
  }
  let parsed;
  try {
    parsed = await gateway.parseWebhook(request);
  } catch (error) {
    // The provider could not be asked (re-fetch): let it deliver again.
    if (error instanceof GatewayError) {
      throw new AppError(502, 'GATEWAY_ERROR', 'Não foi possível validar o pagamento agora.');
    }
    throw error;
  }
  if (!parsed.valid) throw unauthorized('INVALID_SIGNATURE', 'Assinatura inválida');
  if (parsed.ignored === true) return 'ignored';

  const now = deps.now();
  const [inserted] = await deps.db
    .insert(webhookEvents)
    .values({
      provider,
      externalId: parsed.externalId,
      externalStatus: parsed.externalStatus,
      signatureValid: true,
      payload: parsed.raw ?? {},
      receivedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });

  let eventId = inserted?.id;
  if (eventId === undefined) {
    // Already seen: only an event that never finished may be claimed again.
    const staleBefore = new Date(now.getTime() - STALE_AFTER_MS);
    const [claimed] = await deps.db
      .update(webhookEvents)
      .set({ receivedAt: now, error: null })
      .where(
        and(
          eq(webhookEvents.provider, provider),
          eq(webhookEvents.externalId, parsed.externalId),
          eq(webhookEvents.externalStatus, parsed.externalStatus),
          isNull(webhookEvents.processedAt),
          or(sql`${webhookEvents.error} is not null`, lt(webhookEvents.receivedAt, staleBefore)),
        ),
      )
      .returning({ id: webhookEvents.id });
    if (claimed === undefined) return 'duplicate';
    eventId = claimed.id;
  }

  try {
    await applyProviderStatus(
      deps,
      {
        provider,
        externalId: parsed.externalId,
        chargeId: parsed.chargeId,
        status: parsed.status,
        amountCents: parsed.amountCents,
        feeCents: parsed.feeCents,
        raw: parsed.raw,
      },
      ctx,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.db
      .update(webhookEvents)
      .set({ error: message.slice(0, MAX_ERROR_LENGTH) })
      .where(eq(webhookEvents.id, eventId));
    throw error;
  }
  await deps.db
    .update(webhookEvents)
    .set({ processedAt: deps.now(), error: null })
    .where(eq(webhookEvents.id, eventId));
  return 'processed';
}

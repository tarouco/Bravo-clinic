import { idSchema, isStaff, sandboxActionRequestSchema, type SandboxCharge } from '@bravo/core';
import { eq } from 'drizzle-orm';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import { resolveSession, SESSION_COOKIE } from '../../auth/session';
import { withTransaction } from '../../db/client';
import { bookings, charges } from '../../db/schema';
import { audit } from '../../lib/audit';
import { conflict, forbidden, notFound } from '../../lib/errors';
import { auditContext, requestMeta } from '../../lib/request-meta';
import { csrf } from '../../middleware/csrf';
import { validate } from '../../middleware/validate';
import { SYSTEM_CONTEXT } from '../../modules/payments/payment-effects.service';
import { receivePaymentWebhook } from '../../modules/payments/webhooks.service';
import { buildSandboxWebhook } from '../../payments/adapters/sandbox';
import type { AppEnv } from '../../types';

const idParam = z.object({ id: idSchema });

async function loadSandboxCharge(c: Context<AppEnv>, id: string) {
  const [row] = await c.var.deps.db
    .select({ charge: charges, bookingCode: bookings.code })
    .from(charges)
    .leftJoin(bookings, eq(bookings.id, charges.bookingId))
    .where(eq(charges.id, id));
  if (row === undefined || row.charge.provider !== 'sandbox') throw notFound();
  return row;
}

/**
 * On the Neon `production` branch only an MFA-verified staff session may decide a sandbox
 * charge; otherwise the default gateway would give away free bookings (NUC-121, AD-034).
 * Returns that session's actor, or null off production.
 */
async function sandboxActor(c: Context<AppEnv>) {
  const { db, env, now } = c.var.deps;
  const token = getCookie(c, SESSION_COOKIE);
  const auth =
    token === undefined ? null : await resolveSession(db, token, env.SESSION_SECRET, now());
  if (env.NEON_BRANCH === 'production') {
    if (auth === null || !isStaff(auth.role) || !auth.totpConfirmed || !auth.mfaVerified) {
      throw forbidden();
    }
  }
  return auth === null ? null : { id: auth.userId, role: auth.role as string };
}

/** The hosted fake checkout the sandbox gateway sends customers to (NUC-120, NUC-121). */
export function sandboxRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/sandbox/charges/:id', validate('param', idParam), async (c) => {
    const { charge, bookingCode } = await loadSandboxCharge(c, c.req.valid('param').id);
    const body: SandboxCharge = {
      id: charge.id,
      amountCents: charge.amountCents,
      method: charge.method as SandboxCharge['method'],
      status: charge.status as SandboxCharge['status'],
      purpose: charge.purpose as SandboxCharge['purpose'],
      bookingCode,
      bookingId: charge.bookingId,
      expiresAt: charge.expiresAt?.toISOString() ?? null,
      pixCopyPaste: charge.pixCopyPaste,
    };
    return c.json(body);
  });

  // Cookie-authenticated mutations on a public route still need the same-origin check.
  const sameOrigin: MiddlewareHandler<AppEnv> = (c, next) =>
    csrf(c.var.deps.env.APP_BASE_URL)(c, next);

  for (const [action, status] of [
    ['approve', 'approved'],
    ['reject', 'rejected'],
  ] as const) {
    app.post(
      `/sandbox/charges/:id/${action}`,
      sameOrigin,
      validate('param', idParam),
      validate('json', sandboxActionRequestSchema),
      async (c) => {
        const { db, env } = c.var.deps;
        const actor = await sandboxActor(c);
        const { charge } = await loadSandboxCharge(c, c.req.valid('param').id);
        if (charge.status !== 'pending') {
          throw conflict('INVALID_STATE', 'Este pagamento já foi processado.');
        }
        const meta = requestMeta(c);
        await withTransaction(db, (tx) =>
          audit(tx, auditContext(meta, actor), {
            action: `payment.sandbox_${action}`,
            entityType: 'charge',
            entityId: charge.id,
          }),
        );
        // Same pipeline as a real provider: a signed webhook, deduplicated and applied once.
        await receivePaymentWebhook(
          c.var.deps,
          'sandbox',
          {
            ...buildSandboxWebhook(
              {
                chargeId: charge.id,
                externalId: charge.externalId ?? `sbx_${charge.id}`,
                status,
                amountCents: charge.amountCents,
              },
              env,
            ),
            query: {},
          },
          { ...SYSTEM_CONTEXT, requestId: meta.requestId },
        );
        const after = await loadSandboxCharge(c, charge.id);
        return c.json({ status: after.charge.status as SandboxCharge['status'] });
      },
    );
  }

  return app;
}

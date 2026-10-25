import type { Tx } from '../../db/client';
import { verifyEmailTemplate } from '../../emails/templates/verify-email';
import type { Env } from '../../env';
import { queueEmail } from '../../lib/email';
import { appUrl } from '../../lib/request-meta';
import { createAuthToken } from './auth-tokens';

/** Creates a 24-hour verification token and queues the `auth.verify_email` message in `tx`. */
export async function queueVerificationEmail(
  tx: Tx,
  ctx: { env: Pick<Env, 'APP_BASE_URL'>; now: Date },
  user: { id: string; name: string; email: string },
): Promise<string> {
  const token = await createAuthToken(tx, {
    userId: user.id,
    purpose: 'email_verify',
    now: ctx.now,
  });
  const link = appUrl(ctx.env, `/verificar-email?token=${token}`);
  return queueEmail(tx, {
    to: user.email,
    template: 'auth.verify_email',
    ...verifyEmailTemplate({ name: user.name, link }),
  });
}

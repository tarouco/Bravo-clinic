import { DOCUMENT_MESSAGE, parseDocument, type SignupInput } from '@bravo/core';
import { issueSession } from '../../auth/session';
import { withTransaction } from '../../db/client';
import { consents, users } from '../../db/schema';
import { hashPassword } from '../../lib/crypto';
import { dispatchEmails } from '../../lib/email';
import { conflict, uniqueViolationConstraint, validationFailed } from '../../lib/errors';
import type { RequestMeta } from '../../lib/request-meta';
import type { AppDeps } from '../../types';
import { queueVerificationEmail } from './email-verification.service';
import { toUserPayload, type UserPayload } from './user-payload';

export const TERMS_VERSION = 'terms-2026-10';
export const PRIVACY_VERSION = 'privacy-2026-10';

export interface SignupResult {
  user: UserPayload;
  session: { token: string; maxAgeSeconds: number };
}

/** Unique violations on the e-mail or document index are the only expected conflicts (FND-45, FND-46). */
function conflictFor(error: unknown): Error {
  const constraint = uniqueViolationConstraint(error);
  if (constraint === 'users_email_uq') return conflict('EMAIL_TAKEN', 'E-mail já cadastrado');
  if (constraint === 'users_doc_uq') return conflict('DOCUMENT_TAKEN', 'CPF ou CNPJ já cadastrado');
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Creates a tenant with its consents, a verification token and e-mail, and a session, all in one
 * transaction; the e-mail is sent only after it commits.
 */
export async function signup(
  deps: AppDeps,
  input: SignupInput,
  meta: RequestMeta,
): Promise<SignupResult> {
  const document = parseDocument(input.document);
  if (document === null) {
    throw validationFailed([{ path: ['document'], message: DOCUMENT_MESSAGE }]);
  }
  const now = deps.now();
  const passwordHash = await hashPassword(input.password);

  let created;
  try {
    created = await withTransaction(deps.db, async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          role: 'tenant',
          name: input.name,
          email: input.email,
          passwordHash,
          docType: document.type,
          docNumber: document.digits,
          phone: input.phone,
          profession: input.profession ?? null,
          professionalRegistry: input.professionalRegistry ?? null,
        })
        .returning();
      if (user === undefined) throw new Error('signup: insert returned no row');

      const consent = { userId: user.id, acceptedAt: now, ip: meta.ip, userAgent: meta.userAgent };
      await tx.insert(consents).values([
        { ...consent, kind: 'terms', version: TERMS_VERSION },
        { ...consent, kind: 'privacy', version: PRIVACY_VERSION },
      ]);
      const emailId = await queueVerificationEmail(tx, { env: deps.env, now }, user);
      const session = await issueSession(
        tx,
        deps.env.SESSION_SECRET,
        { id: user.id, role: 'tenant' },
        {
          mfaVerified: false,
          ip: meta.ip,
          userAgent: meta.userAgent,
          now,
        },
      );
      return { user, emailId, session };
    });
  } catch (error) {
    throw conflictFor(error);
  }

  await dispatchEmails(deps.db, [created.emailId], { env: deps.env, fetch: deps.fetch });
  return {
    user: toUserPayload(created.user, { enrolled: false, verified: false }),
    session: { token: created.session.token, maxAgeSeconds: created.session.maxAgeSeconds },
  };
}

import { parseDocument, type Me, type UpdateMeInput } from '@bravo/core';
import { eq } from 'drizzle-orm';
import type { AuthContext } from '../../auth/session';
import type { Db } from '../../db/client';
import { users } from '../../db/schema';
import { conflict, notFound, uniqueViolationConstraint, validationFailed } from '../../lib/errors';
import { toUserPayload } from './user-payload';

type UserRow = typeof users.$inferSelect;

/** The `GET /app/me` payload plus the profile fields núcleo edits (`meSchema`). */
function toMe(user: UserRow, auth: AuthContext): Me {
  return {
    ...toUserPayload(user, { enrolled: auth.totpConfirmed, verified: auth.mfaVerified }),
    phone: user.phone,
    profession: user.profession,
    professionalRegistry: user.professionalRegistry,
    document: user.docNumber,
  };
}

const blankToNull = (value: string): string | null => (value === '' ? null : value);

/**
 * `PATCH /app/me` (NUC-192): name, phone, profession and registry are plain updates; the
 * document can be set once (a second one is a 422) and must belong to nobody else (409).
 */
export async function updateProfile(db: Db, auth: AuthContext, input: UpdateMeInput): Promise<Me> {
  const [user] = await db.select().from(users).where(eq(users.id, auth.userId));
  if (user === undefined) throw notFound();

  const changes: Partial<typeof users.$inferInsert> = {};
  if (input.name !== undefined) changes.name = input.name;
  if (input.phone !== undefined) changes.phone = input.phone;
  if (input.profession !== undefined) changes.profession = blankToNull(input.profession);
  if (input.professionalRegistry !== undefined) {
    changes.professionalRegistry = blankToNull(input.professionalRegistry);
  }
  if (input.document !== undefined) {
    if (user.docNumber !== null) {
      throw validationFailed([
        { path: ['document'], message: 'O CPF ou CNPJ já foi informado e não pode ser alterado' },
      ]);
    }
    const document = parseDocument(input.document);
    if (document === null) {
      throw validationFailed([{ path: ['document'], message: 'CPF ou CNPJ inválido' }]);
    }
    changes.docType = document.type;
    changes.docNumber = document.digits;
  }
  if (Object.keys(changes).length === 0) return toMe(user, auth);

  try {
    const [updated] = await db
      .update(users)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .returning();
    if (updated === undefined) throw notFound();
    return toMe(updated, auth);
  } catch (error) {
    if (uniqueViolationConstraint(error) === 'users_doc_uq') {
      throw conflict('DOCUMENT_TAKEN', 'CPF ou CNPJ já cadastrado');
    }
    throw error;
  }
}

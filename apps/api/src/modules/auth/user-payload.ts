import type { Role } from '@bravo/core';
import type { users } from '../../db/schema';

/** The user as every auth endpoint returns it: never the password hash or any TOTP data. */
export interface UserPayload {
  id: string;
  name: string;
  email: string;
  role: Role;
  emailVerified: boolean;
  docType: 'cpf' | 'cnpj' | null;
  mfa: { enrolled: boolean; verified: boolean };
}

type UserRow = Pick<
  typeof users.$inferSelect,
  'id' | 'name' | 'email' | 'role' | 'emailVerifiedAt' | 'docType'
>;

export function toUserPayload(user: UserRow, mfa: UserPayload['mfa']): UserPayload {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as Role,
    emailVerified: user.emailVerifiedAt !== null,
    docType: user.docType as UserPayload['docType'],
    mfa,
  };
}

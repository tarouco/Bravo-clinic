import type { RoleChangeInput, StaffUserInput } from '@bravo/core';
import { and, asc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { revokeAllSessions } from '../../auth/session';
import type { Db, Tx } from '../../db/client';
import { userTotp, users } from '../../db/schema';
import { audit, type RequestContext } from '../../lib/audit';
import { AppError, conflict, notFound } from '../../lib/errors';
import { createAuthToken } from '../auth/auth-tokens';
import { withNotifications, type NotificationDeps } from '../notifications/notifications.service';

// Usuários (GES-110..GES-114): staff accounts (admin and reception). Every privilege change
// revokes the target's sessions at once (AD-021); an admin never acts on their own account here,
// and the clinic always keeps one active admin.

/** Lifetime of the invite's set-password link (GES-111). */
const INVITE_TTL_SECONDS = 72 * 3600;
const STAFF_ROLES = ['admin', 'reception'];
const ROLE_LABELS: Record<string, string> = { admin: 'administrador', reception: 'recepção' };

type UserRow = typeof users.$inferSelect;

const staffView = (u: UserRow, totpConfirmed: boolean) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role as StaffUserInput['role'],
  status: u.status as 'active' | 'disabled',
  totpConfirmed,
  lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
});
export type StaffUserView = ReturnType<typeof staffView>;

const policyViolation = (message: string) => new AppError(422, 'POLICY_VIOLATION', message);
const lastAdmin = () =>
  new AppError(409, 'LAST_ADMIN', 'É preciso manter ao menos um administrador ativo');

async function totpConfirmed(db: Db | Tx, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: userTotp.userId })
    .from(userTotp)
    .where(and(eq(userTotp.userId, userId), isNotNull(userTotp.confirmedAt)));
  return row !== undefined;
}

/** `GET /admin/users` (GES-110): every staff account, disabled ones included, by name. */
export async function listStaffUsers(db: Db | Tx): Promise<{ items: StaffUserView[] }> {
  const rows = await db
    .select({ user: users, confirmedAt: userTotp.confirmedAt })
    .from(users)
    .leftJoin(userTotp, eq(userTotp.userId, users.id))
    .where(and(inArray(users.role, STAFF_ROLES), ne(users.status, 'deleted')))
    .orderBy(asc(users.name), asc(users.id));
  return { items: rows.map((r) => staffView(r.user, r.confirmedAt !== null)) };
}

/**
 * `POST /admin/users` (GES-111). A new e-mail becomes a passwordless staff account with a 72 h
 * set-password link (`staff.invite`, audit `user.invite`); a tenant's e-mail promotes that user
 * in place (audit `user.role_change`, sessions revoked); a staff e-mail is 409 `CONFLICT`.
 */
export async function inviteStaff(
  deps: NotificationDeps,
  ctx: RequestContext,
  input: StaffUserInput,
): Promise<StaffUserView> {
  const now = deps.now();
  return withNotifications(deps, ctx, async (tx, notify) => {
    const [existing] = await tx
      .select()
      .from(users)
      .where(eq(users.email, input.email))
      .for('update');
    if (existing !== undefined) {
      if (existing.role !== 'tenant' || existing.status === 'deleted') {
        throw conflict('CONFLICT', 'Este e-mail já pertence a um usuário da equipe');
      }
      const [promoted] = await tx
        .update(users)
        .set({ role: input.role, updatedAt: now })
        .where(eq(users.id, existing.id))
        .returning();
      if (promoted === undefined) throw notFound();
      await revokeAllSessions(tx, existing.id, now);
      await audit(tx, ctx, {
        action: 'user.role_change',
        entityType: 'user',
        entityId: existing.id,
        before: { role: existing.role },
        after: { role: input.role },
      });
      return staffView(promoted, await totpConfirmed(tx, existing.id));
    }

    const [created] = await tx
      .insert(users)
      .values({
        role: input.role,
        name: input.name,
        email: input.email,
        // The set-password link proves the address, like an account made at the counter.
        emailVerifiedAt: now,
      })
      .returning();
    if (created === undefined) throw new Error('staff insert returned no row');
    const token = await createAuthToken(tx, {
      userId: created.id,
      purpose: 'password_reset',
      now,
      ttlSeconds: INVITE_TTL_SECONDS,
    });
    await notify({
      name: 'staff.invite',
      entityId: created.id,
      to: created.email,
      data: { name: created.name, roleLabel: ROLE_LABELS[input.role], token },
    });
    await audit(tx, ctx, {
      action: 'user.invite',
      entityType: 'user',
      entityId: created.id,
      after: { name: created.name, email: created.email, role: created.role },
    });
    return staffView(created, false);
  });
}

async function lockStaff(tx: Tx, id: string): Promise<UserRow> {
  const [target] = await tx
    .select()
    .from(users)
    .where(and(eq(users.id, id), inArray(users.role, STAFF_ROLES), ne(users.status, 'deleted')))
    .for('update');
  if (target === undefined) throw notFound('NOT_FOUND', 'Usuário não encontrado');
  return target;
}

/** Other active admins than `exceptId`, locked so two concurrent demotions cannot both pass. */
async function otherActiveAdmins(tx: Tx, exceptId: string): Promise<number> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.status, 'active'), ne(users.id, exceptId)))
    .for('update');
  return rows.length;
}

/**
 * `PATCH /admin/users/:id` (GES-112, GES-113): role change, disable or enable, with the target's
 * sessions revoked and audit `user.role_change` / `user.disable` / `user.enable` (before/after).
 * A change that would leave no active admin is 409 `LAST_ADMIN` (checked first, so the only admin
 * demoting themselves hears why); any other change of one's own account is 422.
 */
export async function updateStaffUser(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  input: RoleChangeInput,
  now: Date,
): Promise<StaffUserView> {
  const target = await lockStaff(tx, id);
  const role = input.role ?? target.role;
  const status = input.status ?? target.status;
  const removesAdmin =
    target.role === 'admin' &&
    target.status === 'active' &&
    (role !== 'admin' || status !== 'active');
  if (removesAdmin && (await otherActiveAdmins(tx, id)) === 0) throw lastAdmin();
  if (id === ctx.actorUserId) {
    throw policyViolation('Você não pode alterar o próprio perfil ou desativar a própria conta');
  }
  if (role === target.role && status === target.status) {
    return staffView(target, await totpConfirmed(tx, id));
  }

  const [updated] = await tx
    .update(users)
    .set({ role, status, updatedAt: now })
    .where(eq(users.id, id))
    .returning();
  if (updated === undefined) throw notFound();
  await revokeAllSessions(tx, id, now);
  if (role !== target.role) {
    await audit(tx, ctx, {
      action: 'user.role_change',
      entityType: 'user',
      entityId: id,
      before: { role: target.role },
      after: { role },
    });
  }
  if (status !== target.status) {
    await audit(tx, ctx, {
      action: status === 'disabled' ? 'user.disable' : 'user.enable',
      entityType: 'user',
      entityId: id,
      before: { status: target.status },
      after: { status },
    });
  }
  return staffView(updated, await totpConfirmed(tx, id));
}

/**
 * `POST /admin/users/:id/totp-reset` (GES-114): deletes another staff user's TOTP enrollment and
 * revokes their sessions, with the justification in audit `user.totp_reset`.
 */
export async function resetStaffTotp(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  justification: string,
  now: Date,
): Promise<void> {
  const target = await lockStaff(tx, id);
  if (id === ctx.actorUserId) {
    throw policyViolation('Use a página de segurança para refazer a sua própria verificação');
  }
  const removed = await tx
    .delete(userTotp)
    .where(eq(userTotp.userId, id))
    .returning({ userId: userTotp.userId });
  await revokeAllSessions(tx, id, now);
  await audit(tx, ctx, {
    action: 'user.totp_reset',
    entityType: 'user',
    entityId: target.id,
    justification,
    before: { totpEnrolled: removed.length > 0 },
    after: { totpEnrolled: false },
  });
}

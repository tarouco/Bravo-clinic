import type { StaffUser } from './contracts';

export const STAFF_ROLE_LABELS: Record<StaffUser['role'], string> = {
  admin: 'Administrador',
  reception: 'Recepção',
};

export const STAFF_STATUS_LABELS: Record<StaffUser['status'], string> = {
  active: 'Ativo',
  disabled: 'Desativado',
};

/** Shown for the 409 `LAST_ADMIN` whatever message the API sent (design error table). */
export const LAST_ADMIN_MESSAGE = 'É preciso manter ao menos um administrador ativo';

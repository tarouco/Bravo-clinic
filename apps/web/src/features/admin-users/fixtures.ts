import { parseFixture } from '../../test/fixtures/parse';
import { staffUserListSchema, type StaffUserList } from './contracts';

// Usuários fixtures for the web tests, validated against the response contracts (AD-035).

/** Id of the admin session `stubStaffSession('admin')` signs in. */
export const SELF_ID = '55555555-5555-4555-8555-555555555555';

export const USER_IDS = {
  carla: SELF_ID,
  rui: 'b1000000-0000-4000-8000-000000000002',
  marta: 'b1000000-0000-4000-8000-000000000003',
} as const;

/** Carla (admin, the signed-in user), Rui (reception, 2FA on) and Marta (reception, disabled). */
export function buildStaffUsers(): StaffUserList {
  return parseFixture(
    staffUserListSchema,
    {
      items: [
        {
          id: USER_IDS.carla,
          name: 'Carla Mendes',
          email: 'carla@bravo.example',
          role: 'admin',
          status: 'active',
          totpConfirmed: true,
          lastLoginAt: '2026-10-26T12:30:00.000Z',
        },
        {
          id: USER_IDS.rui,
          name: 'Rui Lima',
          email: 'rui@bravo.example',
          role: 'reception',
          status: 'active',
          totpConfirmed: true,
          lastLoginAt: '2026-10-25T18:00:00.000Z',
        },
        {
          id: USER_IDS.marta,
          name: 'Marta Reis',
          email: 'marta@bravo.example',
          role: 'reception',
          status: 'disabled',
          totpConfirmed: false,
          lastLoginAt: null,
        },
      ],
    },
    'staffUsers',
  );
}

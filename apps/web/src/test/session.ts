import { http, HttpResponse } from 'msw';
import type { Session } from '../features/auth/useSession';
import { server } from './msw/server';

export type StaffRole = 'admin' | 'reception';

/** Makes `GET /api/app/me` answer with a verified staff session of the given role. */
export function stubStaffSession(role: StaffRole): Session {
  const session: Session = {
    id: '55555555-5555-4555-8555-555555555555',
    name: role === 'admin' ? 'Carla Mendes' : 'Rui Lima',
    email: 'staff@example.com',
    role,
    emailVerified: true,
    docType: 'cpf',
    mfa: { enrolled: true, verified: true },
  };
  server.use(http.get('*/api/app/me', () => HttpResponse.json(session)));
  return session;
}

/** Text with the non-breaking spaces of `formatBRL` turned into plain spaces. */
const NBSP = String.fromCharCode(160);
export const plain = (text: string | null | undefined): string =>
  (text ?? '').replaceAll(NBSP, ' ');

import { adminSectionMeta, adminSectionsFor, isStaff, type AdminSection } from '@bravo/core';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ForbiddenPage } from '../../components/layout/ForbiddenPage';
import { Spinner } from '../../components/ui/Feedback';
import { useSession, type Session } from './useSession';

function CenteredSpinner() {
  return (
    <div className="flex justify-center py-space-3xl">
      <Spinner />
    </div>
  );
}

/** The 2FA step for a session that still owes its second factor, returning to `path` after it. */
function verifyRedirect(path: string) {
  return <Navigate to={`/login/2fa?next=${encodeURIComponent(path)}`} replace />;
}

/** A user who turned TOTP on has not yet confirmed the code in this session (AD-037). */
const mfaPending = (session: Session) => session.mfa.enrolled && !session.mfa.verified;

/**
 * Anonymous visitors go to `/login?next=<original path>`; a session that owes its second factor
 * goes to `/login/2fa?next=<original path>`, except on the 2FA step itself (`allowPendingMfa`).
 */
export function RequireAuth({ allowPendingMfa = false }: { allowPendingMfa?: boolean }) {
  const { session, isLoading } = useSession();
  const location = useLocation();
  const path = `${location.pathname}${location.search}`;

  if (isLoading) return <CenteredSpinner />;
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(path)}`} replace />;
  if (!allowPendingMfa && mfaPending(session)) return verifyRedirect(path);
  return <Outlet />;
}

/**
 * Staff area: tenants see the 403 page. Two-factor authentication is optional (AD-037): staff
 * without TOTP enter with their password; staff who turned it on must have verified this session.
 */
export function RequireStaff() {
  const { session, isLoading } = useSession();
  const location = useLocation();

  if (isLoading) return <CenteredSpinner />;
  if (!session) return <Navigate to="/login" replace />;
  if (!isStaff(session.role)) return <ForbiddenPage />;
  if (mfaPending(session)) return verifyRedirect(`${location.pathname}${location.search}`);
  return <Outlet />;
}

/** Admin section gate: roles outside `access.ts` for this section see the 403 page. */
export function RequireSection({ section }: { section: AdminSection }) {
  const { session, isLoading } = useSession();

  if (isLoading) return <CenteredSpinner />;
  if (!session || !adminSectionsFor(session.role).includes(section)) return <ForbiddenPage />;
  return <Outlet />;
}

/** `/admin` index: opens the first section the role may see. */
export function AdminIndexRedirect() {
  const { session } = useSession();
  const [first] = session ? adminSectionsFor(session.role) : [];
  return first ? <Navigate to={adminSectionMeta[first].path} replace /> : <ForbiddenPage />;
}

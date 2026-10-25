import { adminSectionMeta, adminSectionsFor, isStaff, type AdminSection } from '@bravo/core';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ForbiddenPage } from '../../components/layout/ForbiddenPage';
import { Spinner } from '../../components/ui/Feedback';
import { useSession } from './useSession';

function CenteredSpinner() {
  return (
    <div className="flex justify-center py-space-3xl">
      <Spinner />
    </div>
  );
}

/** Anonymous visitors go to `/login?next=<original path>`. */
export function RequireAuth() {
  const { session, isLoading } = useSession();
  const location = useLocation();

  if (isLoading) return <CenteredSpinner />;
  if (!session) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <Outlet />;
}

/** Staff area: tenants see the 403 page; staff without a verified second factor are sent to 2FA. */
export function RequireStaff() {
  const { session, isLoading } = useSession();

  if (isLoading) return <CenteredSpinner />;
  if (!session) return <Navigate to="/login" replace />;
  if (!isStaff(session.role)) return <ForbiddenPage />;
  if (!session.mfa.enrolled) return <Navigate to="/login/2fa/configurar" replace />;
  if (!session.mfa.verified) return <Navigate to="/login/2fa" replace />;
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

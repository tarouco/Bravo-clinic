import { useLocation } from 'react-router-dom';
import { Alert, ComingSoon } from '../../components/ui/Feedback';

/** `/app` landing. Shows the e-mail confirmation banner right after signup. */
export function AppHomePage() {
  const state = useLocation().state as { signupBanner?: boolean } | null;

  return (
    <>
      {state?.signupBanner ? (
        <Alert tone="info" className="mx-auto mt-space-md max-w-2xl">
          Enviamos um link de confirmação para o seu e-mail.
        </Alert>
      ) : null}
      <ComingSoon title="Próximas reservas" />
    </>
  );
}

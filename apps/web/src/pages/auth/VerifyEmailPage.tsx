import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { useResendVerification, useVerifyEmail } from '../../features/auth/hooks';
import { useSession } from '../../features/auth/useSession';
import { ApiError } from '../../lib/api';
import { AuthCard, authLinkClasses } from './AuthCard';

const linkClasses = authLinkClasses;

export function VerifyEmailPage() {
  const token = useSearchParams()[0].get('token');
  const { session } = useSession();
  const verify = useVerifyEmail();
  const resend = useResendVerification();
  const requested = useRef(false);
  const { mutate } = verify;

  // The token is single-use: StrictMode re-runs effects in development, so call only once.
  useEffect(() => {
    if (!token || requested.current) return;
    requested.current = true;
    mutate({ token });
  }, [token, mutate]);

  const failed = !token || verify.isError;
  const invalidLink = !token || (verify.error instanceof ApiError && verify.error.status === 400);

  return (
    <AuthCard title="Confirmar e-mail">
      {verify.isSuccess ? (
        <>
          <Alert tone="success">E-mail confirmado</Alert>
          <Button asChild block>
            <Link to="/app">Ir para minha área</Link>
          </Button>
        </>
      ) : failed ? (
        <>
          <Alert tone="error">
            {invalidLink
              ? 'Link inválido ou expirado'
              : verify.error instanceof ApiError
                ? verify.error.message
                : 'Não foi possível confirmar o e-mail.'}
          </Alert>
          {session ? (
            <>
              {resend.isSuccess ? (
                <Alert tone="info">Enviamos um novo link para o seu e-mail.</Alert>
              ) : null}
              {resend.isError ? (
                <Alert tone="error">Não foi possível reenviar o e-mail. Tente novamente.</Alert>
              ) : null}
              <Button
                variant="secondary"
                loading={resend.isPending}
                onClick={() => resend.mutate()}
                block
              >
                Reenviar e-mail
              </Button>
            </>
          ) : (
            <p className="text-center font-small text-small">
              <Link to="/login" className={linkClasses}>
                Entrar para pedir um novo link
              </Link>
            </p>
          )}
        </>
      ) : (
        <div className="flex justify-center">
          <Spinner label="Confirmando seu e-mail" />
        </div>
      )}
    </AuthCard>
  );
}

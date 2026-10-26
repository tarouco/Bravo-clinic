import { loginSchema, isStaff, type LoginInput } from '@bravo/core';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert } from '../../components/ui/Feedback';
import { Button } from '../../components/ui/Button';
import { Input, PasswordInput } from '../../components/ui/form';
import { safeNextPath, useLogin } from '../../features/auth/hooks';
import { useClinicConfig } from '../../features/config/useClinicConfig';
import { ApiError } from '../../lib/api';
import { AuthCard } from './AuthCard';
import { tooManyAttemptsMessage } from './error-messages';

const GOOGLE_START_URL = '/api/public/auth/google/start';

function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'E-mail ou senha incorretos';
    if (error.status === 429) return tooManyAttemptsMessage(error);
    return error.message;
  }
  return 'Não foi possível entrar. Tente novamente.';
}

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = safeNextPath(searchParams.get('next'));
  const { googleEnabled } = useClinicConfig();
  const login = useLogin();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const { user, mfaRequired } = await login.mutateAsync(values);
      if (mfaRequired) {
        void navigate(next ? `/login/2fa?next=${encodeURIComponent(next)}` : '/login/2fa');
        return;
      }
      void navigate(next ?? (isStaff(user.role) ? '/admin' : '/app'), { replace: true });
    } catch (error) {
      setFormError(loginErrorMessage(error));
    }
  });

  return (
    <AuthCard title="Entrar">
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-space-md">
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <Input
          label="E-mail"
          type="email"
          autoComplete="username"
          error={errors.email?.message}
          {...register('email')}
        />
        <PasswordInput
          label="Senha"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />
        <Button type="submit" loading={login.isPending} className="w-full">
          Entrar
        </Button>
      </form>

      {googleEnabled ? (
        <Button asChild variant="secondary" className="w-full">
          <a href={GOOGLE_START_URL}>Entrar com o Google</a>
        </Button>
      ) : null}

      <div className="flex flex-col items-center gap-space-xs font-small text-small">
        <Link to="/esqueci-senha" className="text-bronze underline underline-offset-4">
          Esqueci minha senha
        </Link>
        <Link
          to={next ? `/cadastro?next=${encodeURIComponent(next)}` : '/cadastro'}
          className="text-bronze underline underline-offset-4"
        >
          Criar conta
        </Link>
      </div>
    </AuthCard>
  );
}

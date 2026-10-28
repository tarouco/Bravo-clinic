import { isStaff } from '@bravo/core';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { Input } from '../../components/ui/form';
import { safeNextPath, useTotpVerify } from '../../features/auth/hooks';
import {
  codeErrorMessage,
  codeRule,
  normalizeCode,
  type CodeFormValues,
} from '../../features/auth/two-factor';
import { useSession } from '../../features/auth/useSession';
import { AuthCard } from './AuthCard';

/**
 * `/login/2fa`: the second factor of a user who turned TOTP on (any role, AD-037). Continues to
 * `next`, else to `/admin` for staff and `/app` for tenants.
 */
export function TwoFactorVerifyPage() {
  const navigate = useNavigate();
  const next = safeNextPath(useSearchParams()[0].get('next'));
  const { session } = useSession();
  const staff = session !== null && isStaff(session.role);
  const verify = useTotpVerify();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CodeFormValues>();

  const onSubmit = handleSubmit(async ({ code }) => {
    setFormError(null);
    try {
      await verify.mutateAsync({ code: normalizeCode(code) });
      void navigate(next ?? (staff ? '/admin' : '/app'), { replace: true });
    } catch (error) {
      setFormError(codeErrorMessage(error));
    }
  });

  return (
    <AuthCard title="Verificação em duas etapas" {...(staff ? { eyebrow: 'Área restrita' } : {})}>
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-space-md">
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <Input
          label="Código de verificação"
          autoComplete="one-time-code"
          inputMode="text"
          help="Digite o código de 6 dígitos do aplicativo autenticador ou um código de recuperação."
          error={errors.code?.message}
          {...register('code', { validate: codeRule })}
        />
        <Button type="submit" loading={verify.isPending} className="w-full">
          Verificar
        </Button>
      </form>
    </AuthCard>
  );
}

import { PASSWORD_MESSAGE, passwordSchema } from '@bravo/core';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../../../components/ui/Button';
import { Alert } from '../../../components/ui/Feedback';
import { PasswordInput } from '../../../components/ui/form';
import { useConfirmPasswordReset } from '../../../features/auth/hooks';
import { ApiError } from '../../../lib/api';
import { AuthCard } from '../AuthCard';

const linkClasses = 'text-bronze underline underline-offset-4';
const INVALID_LINK_MESSAGE = 'Link inválido ou expirado';

interface ResetFormValues {
  password: string;
  confirmation: string;
}

export function ResetPasswordPage() {
  const token = useSearchParams()[0].get('token');
  const confirm = useConfirmPasswordReset();
  const [done, setDone] = useState(false);
  const [linkInvalid, setLinkInvalid] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<ResetFormValues>();

  const onSubmit = handleSubmit(async ({ password }) => {
    if (!token) return;
    setFormError(null);
    try {
      await confirm.mutateAsync({ token, password });
      setDone(true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) setLinkInvalid(true);
      else
        setFormError(
          error instanceof ApiError ? error.message : 'Não foi possível alterar a senha.',
        );
    }
  });

  if (done) {
    return (
      <AuthCard title="Redefinir senha">
        <Alert tone="success">Senha alterada</Alert>
        <Button asChild className="w-full">
          <Link to="/login">Entrar</Link>
        </Button>
      </AuthCard>
    );
  }

  if (!token || linkInvalid) {
    return (
      <AuthCard title="Redefinir senha">
        <Alert tone="error">{INVALID_LINK_MESSAGE}</Alert>
        <p className="text-center font-small text-small">
          <Link to="/esqueci-senha" className={linkClasses}>
            Solicitar um novo link
          </Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Redefinir senha">
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-space-md">
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <PasswordInput
          label="Nova senha"
          autoComplete="new-password"
          help="De 8 a 128 caracteres, com letras e números"
          error={errors.password?.message}
          {...register('password', {
            validate: (value) => passwordSchema.safeParse(value).success || PASSWORD_MESSAGE,
          })}
        />
        <PasswordInput
          label="Confirmar nova senha"
          autoComplete="new-password"
          error={errors.confirmation?.message}
          {...register('confirmation', {
            validate: (value) => value === getValues('password') || 'As senhas não conferem',
          })}
        />
        <Button type="submit" loading={confirm.isPending} className="w-full">
          Redefinir senha
        </Button>
      </form>
    </AuthCard>
  );
}

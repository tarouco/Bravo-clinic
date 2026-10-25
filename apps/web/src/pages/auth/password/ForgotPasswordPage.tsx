import { passwordResetRequestSchema } from '@bravo/core';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { Button } from '../../../components/ui/Button';
import { Alert } from '../../../components/ui/Feedback';
import { Input } from '../../../components/ui/form';
import { useRequestPasswordReset } from '../../../features/auth/hooks';
import { ApiError } from '../../../lib/api';
import { AuthCard } from '../AuthCard';

const linkClasses = 'text-bronze underline underline-offset-4';

export function ForgotPasswordPage() {
  const request = useRequestPasswordReset();
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(passwordResetRequestSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await request.mutateAsync(values);
      // Same message whether or not the e-mail is registered, so the page never reveals accounts.
      setSent(true);
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.message : 'Não foi possível enviar. Tente novamente.',
      );
    }
  });

  return (
    <AuthCard title="Esqueci minha senha">
      {sent ? (
        <Alert tone="success">
          Se o e-mail estiver cadastrado, você receberá um link em instantes.
        </Alert>
      ) : (
        <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-space-md">
          <p className="font-small text-small text-ink-muted">
            Informe o e-mail da sua conta para receber um link de redefinição.
          </p>
          {formError ? <Alert tone="error">{formError}</Alert> : null}
          <Input
            label="E-mail"
            type="email"
            autoComplete="email"
            error={errors.email?.message}
            {...register('email')}
          />
          <Button type="submit" loading={request.isPending} className="w-full">
            Enviar link
          </Button>
        </form>
      )}
      <p className="text-center font-small text-small">
        <Link to="/login" className={linkClasses}>
          Voltar para entrar
        </Link>
      </p>
    </AuthCard>
  );
}

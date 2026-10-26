import { signupSchema } from '@bravo/core';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, type Path } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import {
  Checkbox,
  DocumentInput,
  Input,
  PasswordInput,
  PhoneInput,
} from '../../components/ui/form';
import { safeNextPath, useSignup } from '../../features/auth/hooks';
import { ApiError } from '../../lib/api';
import { AuthCard } from './AuthCard';

const EMAIL_TAKEN_MESSAGE = 'Este e-mail já está cadastrado.';
const DOCUMENT_TAKEN_MESSAGE = 'Este CPF/CNPJ já está cadastrado.';

const linkClasses = 'text-bronze underline underline-offset-4';

export function SignupPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = safeNextPath(searchParams.get('next'));
  const signup = useSignup();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors },
  } = useForm({ resolver: zodResolver(signupSchema) });

  const [acceptTerms, acceptPrivacy] = watch(['acceptTerms', 'acceptPrivacy']);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await signup.mutateAsync(values);
      void navigate(next ?? '/app', { state: { signupBanner: true } });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'EMAIL_TAKEN') {
        setError('email', { message: EMAIL_TAKEN_MESSAGE });
      } else if (error instanceof ApiError && error.code === 'DOCUMENT_TAKEN') {
        setError('document', { message: DOCUMENT_TAKEN_MESSAGE });
      } else if (error instanceof ApiError && error.details.length > 0) {
        // Server-side validation failures map back onto the fields they name.
        for (const detail of error.details) {
          setError(detail.path as Path<typeof values>, { message: detail.message });
        }
      } else {
        setFormError(
          error instanceof ApiError
            ? error.message
            : 'Não foi possível criar a conta. Tente novamente.',
        );
      }
    }
  });

  return (
    <AuthCard title="Criar conta">
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-space-md">
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <Input
          label="Nome completo"
          autoComplete="name"
          error={errors.name?.message}
          {...register('name')}
        />
        <DocumentInput
          label="CPF ou CNPJ"
          error={errors.document?.message}
          {...register('document')}
        />
        <Input
          label="E-mail"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <PhoneInput label="Telefone" error={errors.phone?.message} {...register('phone')} />
        <Input
          label="Profissão (opcional)"
          error={errors.profession?.message}
          {...register('profession')}
        />
        <Input
          label="Registro profissional (opcional)"
          error={errors.professionalRegistry?.message}
          {...register('professionalRegistry')}
        />
        <PasswordInput
          label="Senha"
          autoComplete="new-password"
          help="De 8 a 128 caracteres, com letras e números"
          error={errors.password?.message}
          {...register('password')}
        />
        <Checkbox
          label={
            <>
              Li e aceito os{' '}
              <Link to="/termos" target="_blank" rel="noreferrer" className={linkClasses}>
                Termos de uso
              </Link>
            </>
          }
          error={errors.acceptTerms?.message}
          {...register('acceptTerms')}
        />
        <Checkbox
          label={
            <>
              Li e aceito a{' '}
              <Link to="/privacidade" target="_blank" rel="noreferrer" className={linkClasses}>
                Política de privacidade
              </Link>
            </>
          }
          error={errors.acceptPrivacy?.message}
          {...register('acceptPrivacy')}
        />
        <Button
          type="submit"
          loading={signup.isPending}
          disabled={!(acceptTerms && acceptPrivacy)}
          className="w-full"
        >
          Criar conta
        </Button>
      </form>

      <p className="text-center font-small text-small text-ink-muted">
        Já tem conta?{' '}
        <Link
          to={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}
          className={linkClasses}
        >
          Entrar
        </Link>
      </p>
    </AuthCard>
  );
}

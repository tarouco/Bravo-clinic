import { totpCodeSchema } from '@bravo/core';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { Input } from '../../components/ui/form';
import {
  safeNextPath,
  useTotpConfirm,
  useTotpEnroll,
  useTotpVerify,
} from '../../features/auth/hooks';
import { ApiError } from '../../lib/api';
import { AuthCard } from './AuthCard';
import { tooManyAttemptsMessage } from './error-messages';

const INVALID_CODE_MESSAGE = 'Código inválido';

interface CodeFormValues {
  code: string;
}

/** Validates with the shared schema and returns the normalized code (spaces removed). */
const codeRule = (value: string) => totpCodeSchema.safeParse(value).success || INVALID_CODE_MESSAGE;
const normalizeCode = (value: string) => {
  const parsed = totpCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : value;
};

function codeErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return INVALID_CODE_MESSAGE;
    if (error.status === 429) return tooManyAttemptsMessage(error);
    return error.message;
  }
  return 'Não foi possível verificar o código. Tente novamente.';
}

export function TwoFactorVerifyPage() {
  const navigate = useNavigate();
  const next = safeNextPath(useSearchParams()[0].get('next'));
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
      void navigate(next ?? '/admin', { replace: true });
    } catch (error) {
      setFormError(codeErrorMessage(error));
    }
  });

  return (
    <AuthCard title="Verificação em duas etapas" eyebrow="Área restrita">
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

/** The shared secret in the otpauth URI, in groups of four for manual entry. */
function manualSecret(otpauthUri: string): string {
  const secret = new URL(otpauthUri).searchParams.get('secret') ?? '';
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

export function TwoFactorEnrollPage() {
  const navigate = useNavigate();
  const enroll = useTotpEnroll();
  const confirm = useTotpConfirm();
  const requested = useRef(false);
  const { mutate: startEnrollment } = enroll;
  const otpauthUri = enroll.data?.otpauthUri;
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Each enrollment call replaces the stored secret, so StrictMode must not trigger it twice.
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    startEnrollment();
  }, [startEnrollment]);

  useEffect(() => {
    if (!otpauthUri) return;
    let cancelled = false;
    void QRCode.toDataURL(otpauthUri, { width: 224, margin: 1 }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [otpauthUri]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CodeFormValues>();

  const onSubmit = handleSubmit(async ({ code }) => {
    setFormError(null);
    try {
      await confirm.mutateAsync({ code: normalizeCode(code) });
    } catch (error) {
      setFormError(codeErrorMessage(error));
    }
  });

  if (confirm.data) {
    return (
      <AuthCard title="Códigos de recuperação" eyebrow="Área restrita">
        <Alert tone="info">
          Guarde estes códigos em local seguro. Cada um vale uma única vez e não será exibido
          novamente.
        </Alert>
        <ul className="grid grid-cols-2 gap-space-sm font-mono text-small text-ink">
          {confirm.data.recoveryCodes.map((code) => (
            <li
              key={code}
              className="rounded-control border border-hairline px-space-sm py-space-xs"
            >
              {code}
            </li>
          ))}
        </ul>
        <Button onClick={() => void navigate('/admin', { replace: true })} className="w-full">
          Já guardei os códigos
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Configurar verificação em duas etapas" eyebrow="Área restrita">
      {enroll.isError ? (
        <>
          <Alert tone="error">Não foi possível iniciar a configuração. Tente novamente.</Alert>
          <Button variant="secondary" onClick={() => startEnrollment()} className="w-full">
            Tentar novamente
          </Button>
        </>
      ) : !otpauthUri ? (
        <div className="flex justify-center">
          <Spinner label="Preparando a configuração" />
        </div>
      ) : (
        <>
          <p className="font-small text-small text-ink-muted">
            Leia o QR code com um aplicativo autenticador e informe o código de 6 dígitos gerado.
          </p>
          <div className="flex justify-center">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="QR code para o aplicativo autenticador"
                width={224}
                height={224}
                className="rounded-control border border-hairline bg-white"
              />
            ) : (
              <Spinner label="Gerando QR code" />
            )}
          </div>
          <p className="text-center font-caption text-caption text-ink-muted">
            Ou digite a chave manualmente:{' '}
            <span className="font-mono text-ink">{manualSecret(otpauthUri)}</span>
          </p>
          <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-space-md">
            {formError ? <Alert tone="error">{formError}</Alert> : null}
            <Input
              label="Código de 6 dígitos"
              autoComplete="one-time-code"
              inputMode="numeric"
              error={errors.code?.message}
              {...register('code', { validate: codeRule })}
            />
            <Button type="submit" loading={confirm.isPending} className="w-full">
              Confirmar
            </Button>
          </form>
        </>
      )}
    </AuthCard>
  );
}

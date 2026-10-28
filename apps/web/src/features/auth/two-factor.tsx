import { totpCodeSchema } from '@bravo/core';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '../../components/ui/Button';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { Input } from '../../components/ui/form';
import { ApiError } from '../../lib/api';
import { tooManyAttemptsMessage } from '../../pages/auth/error-messages';
import { useTotpConfirm, useTotpEnroll } from './hooks';

// Shared by the 2FA login step (`/login/2fa`) and the opt-in toggle on `/app/perfil/seguranca`.

export const INVALID_CODE_MESSAGE = 'Código inválido';

export interface CodeFormValues {
  code: string;
}

/** Validates with the shared schema (`react-hook-form` rule). */
export const codeRule = (value: string) =>
  totpCodeSchema.safeParse(value).success || INVALID_CODE_MESSAGE;

/** The normalized code (spaces removed, recovery codes upper-cased). */
export const normalizeCode = (value: string) => {
  const parsed = totpCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : value;
};

export function codeErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return INVALID_CODE_MESSAGE;
    if (error.status === 429) return tooManyAttemptsMessage(error);
    return error.message;
  }
  return 'Não foi possível verificar o código. Tente novamente.';
}

/** The shared secret in the otpauth URI, in groups of four for manual entry. */
function manualSecret(otpauthUri: string): string {
  const secret = new URL(otpauthUri).searchParams.get('secret') ?? '';
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

/** The ten recovery codes, shown once right after the enrollment is confirmed. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <div className="space-y-space-md">
      <Alert tone="info">
        Guarde estes códigos em local seguro. Cada um vale uma única vez e não será exibido
        novamente.
      </Alert>
      <ul
        aria-label="Códigos de recuperação"
        className="grid grid-cols-2 gap-space-sm font-mono text-small text-ink"
      >
        {codes.map((code) => (
          <li key={code} className="rounded-control border border-hairline px-space-sm py-space-xs">
            {code}
          </li>
        ))}
      </ul>
      <Button onClick={onDone} className="w-full">
        Já guardei os códigos
      </Button>
    </div>
  );
}

/**
 * Enrollment: starts it once on mount, shows the QR code and the manual key, confirms the first
 * code, then the recovery codes; `onDone` runs when the user has saved them (FND-64, FND-65).
 */
export function TotpEnrollment({ onDone }: { onDone: () => void }) {
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

  if (confirm.data) return <RecoveryCodes codes={confirm.data.recoveryCodes} onDone={onDone} />;

  if (enroll.isError) {
    return (
      <div className="space-y-space-md">
        <Alert tone="error">Não foi possível iniciar a configuração. Tente novamente.</Alert>
        <Button variant="secondary" onClick={() => startEnrollment()} className="w-full">
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (!otpauthUri) {
    return (
      <div className="flex justify-center">
        <Spinner label="Preparando a configuração" />
      </div>
    );
  }

  return (
    <div className="space-y-space-md">
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
    </div>
  );
}

import { isStaff } from '@bravo/core';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { Input } from '../../components/ui/form';
import { useTotpDisable } from '../../features/auth/hooks';
import {
  codeErrorMessage,
  codeRule,
  normalizeCode,
  TotpEnrollment,
  type CodeFormValues,
} from '../../features/auth/two-factor';
import { useSession } from '../../features/auth/useSession';
import { usePageTitle } from '../../lib/usePageTitle';

/** Asks for a current code or a recovery code and turns two-factor authentication off. */
function DisableForm({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const disable = useTotpDisable();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CodeFormValues>();

  const onSubmit = handleSubmit(async ({ code }) => {
    setFormError(null);
    try {
      await disable.mutateAsync({ code: normalizeCode(code) });
      onDone();
    } catch (error) {
      setFormError(codeErrorMessage(error));
    }
  });

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-space-md">
      {formError ? <Alert tone="error">{formError}</Alert> : null}
      <Input
        label="Código de verificação"
        autoComplete="one-time-code"
        inputMode="text"
        help="Para desativar, digite o código de 6 dígitos do aplicativo autenticador ou um código de recuperação."
        error={errors.code?.message}
        {...register('code', { validate: codeRule })}
      />
      <div className="flex flex-wrap gap-space-sm">
        <Button type="submit" loading={disable.isPending}>
          Desativar verificação
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

type Mode = 'view' | 'enroll' | 'disable';

/**
 * `/app/perfil/seguranca`: the opt-in two-factor toggle every role reaches from its preferences
 * (FND-135, FND-136, AD-037).
 */
export function SecurityPage() {
  usePageTitle('Segurança');
  const { session } = useSession();
  const [mode, setMode] = useState<Mode>('view');
  const [justDisabled, setJustDisabled] = useState(false);

  if (!session) {
    return (
      <div className="flex justify-center">
        <Spinner label="Carregando" />
      </div>
    );
  }

  const enabled = session.mfa.enrolled;
  const backTo = isStaff(session.role) ? '/admin' : '/app/perfil';

  return (
    <div className="mx-auto max-w-xl space-y-space-lg">
      <h1 className="font-display-l-mobile text-display-l-mobile text-ink lg:font-display-l lg:text-display-l">
        Segurança
      </h1>

      <section aria-labelledby="two-factor-heading" className="bv-card space-y-space-md">
        <div className="flex flex-wrap items-center gap-space-sm">
          <h2 id="two-factor-heading" className="font-heading-mobile text-heading-mobile text-ink">
            Verificação em duas etapas
          </h2>
          <Badge tone={enabled ? 'emerald' : 'neutral'}>{enabled ? 'Ativada' : 'Desativada'}</Badge>
        </div>
        <p className="font-body text-body text-ink-muted">
          Opcional. Com ela ativada, além da senha, pedimos a cada login um código do seu aplicativo
          autenticador (Google Authenticator, Microsoft Authenticator, 1Password e similares).
        </p>

        {mode === 'enroll' ? (
          <TotpEnrollment onDone={() => setMode('view')} />
        ) : mode === 'disable' && enabled ? (
          <DisableForm
            onCancel={() => setMode('view')}
            onDone={() => {
              setJustDisabled(true);
              setMode('view');
            }}
          />
        ) : enabled ? (
          <div className="space-y-space-sm">
            <Alert tone="success">
              A verificação em duas etapas está ativa. Seu próximo login pedirá o código.
            </Alert>
            <Button variant="secondary" onClick={() => setMode('disable')}>
              Desativar
            </Button>
          </div>
        ) : (
          <div className="space-y-space-sm">
            {justDisabled ? (
              <Alert tone="success">A verificação em duas etapas foi desativada.</Alert>
            ) : null}
            <Button
              onClick={() => {
                setJustDisabled(false);
                setMode('enroll');
              }}
            >
              Ativar
            </Button>
          </div>
        )}
      </section>

      <Button asChild variant="ghost" size="sm">
        <Link to={backTo}>{isStaff(session.role) ? 'Voltar ao painel' : 'Voltar ao perfil'}</Link>
      </Button>
    </div>
  );
}

import { gatewayCredentialsSchema } from '@bravo/core';
import { useId, useState } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { CopyField } from '../../../components/ui/CopyField';
import { Alert, Spinner } from '../../../components/ui/Feedback';
import { Checkbox, Input, Select } from '../../../components/ui/form';
import { Modal } from '../../../components/ui/Modal';
import { useToast } from '../../../components/ui/Toast';
import {
  useActivateGateway,
  useGateway,
  useSaveGateway,
  useTestGateway,
} from '../../../features/admin-integrations/api';
import type {
  GatewayAdapter,
  GatewayTestResult,
} from '../../../features/admin-integrations/contracts';
import { ENVIRONMENT_LABELS } from '../../../features/admin-integrations/labels';
import { fieldErrorsOf, messageOf } from '../../../lib/api-errors';

interface CardProps {
  adapter: GatewayAdapter;
  active: boolean;
}

/** One provider: credential form, connection test and activation (GES-36..GES-39). */
function ProviderCard({ adapter, active }: CardProps) {
  const headingId = useId();
  const { toast } = useToast();
  const save = useSaveGateway(adapter.provider);
  const test = useTestGateway(adapter.provider);
  const activate = useActivateGateway(adapter.provider);

  const [enabled, setEnabled] = useState(adapter.enabled);
  const [environment, setEnvironment] = useState<'test' | 'production'>(
    adapter.environment ?? 'test',
  );
  const [config, setConfig] = useState<Record<string, string>>(adapter.config);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<GatewayTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);

  const secretFields = adapter.fields.filter((f) => f.secret);
  const plainFields = adapter.fields.filter((f) => !f.secret);
  const needsCredentials = adapter.fields.length > 0;

  const submit = () => {
    setFormError(null);
    // An untouched secret goes as an empty string, which keeps the stored one (GES-36).
    const parsed = gatewayCredentialsSchema.safeParse({
      enabled,
      environment,
      config: Object.fromEntries(plainFields.map((f) => [f.key, config[f.key] ?? ''])),
      secrets: Object.fromEntries(secretFields.map((f) => [f.key, secrets[f.key] ?? ''])),
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[issue.path.length - 1] ?? 'form');
        if (!(key in next)) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    save.mutate(parsed.data, {
      onSuccess: () => {
        setSecrets({});
        toast({ message: 'Configuração salva.' });
      },
      onError: (error) => {
        const fields = fieldErrorsOf(error);
        if (Object.keys(fields).length > 0) setErrors(fields);
        else setFormError(messageOf(error, 'Não foi possível salvar a configuração.'));
      },
    });
  };

  const runTest = () => {
    setResult(null);
    setTestError(null);
    test.mutate(undefined, {
      onSuccess: setResult,
      onError: (error) => {
        setTestError(messageOf(error, 'Não foi possível testar a conexão.'));
      },
    });
  };

  const canActivate = adapter.configured && adapter.enabled && !active;

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-space-md rounded-card border border-hairline bg-surface-raised p-space-lg"
    >
      <header className="flex flex-wrap items-center gap-space-sm">
        <h2 id={headingId} className="font-heading text-heading-mobile text-ink">
          {adapter.label}
        </h2>
        {active ? <Badge tone="bronze">Ativo</Badge> : null}
        <Badge tone={adapter.configured ? 'champagne' : 'neutral'}>
          {adapter.configured ? 'Configurado' : 'Não configurado'}
        </Badge>
      </header>

      {needsCredentials ? (
        <form
          className="space-y-space-md"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-space-md sm:grid-cols-2">
            <Select
              label="Ambiente"
              value={environment}
              error={errors['environment']}
              onChange={(event) => {
                setEnvironment(event.target.value as 'test' | 'production');
              }}
            >
              {(Object.keys(ENVIRONMENT_LABELS) as (keyof typeof ENVIRONMENT_LABELS)[]).map(
                (value) => (
                  <option key={value} value={value}>
                    {ENVIRONMENT_LABELS[value]}
                  </option>
                ),
              )}
            </Select>
            <Checkbox
              label="Habilitado"
              className="self-end pb-space-sm"
              checked={enabled}
              onChange={(event) => {
                setEnabled(event.target.checked);
              }}
            />
          </div>
          {plainFields.map((field) => (
            <Input
              key={field.key}
              label={field.label}
              value={config[field.key] ?? ''}
              error={errors[field.key]}
              onChange={(event) => {
                setConfig((current) => ({ ...current, [field.key]: event.target.value }));
              }}
            />
          ))}
          {secretFields.map((field) => (
            <Input
              key={field.key}
              label={field.label}
              type="password"
              autoComplete="off"
              value={secrets[field.key] ?? ''}
              placeholder={adapter.secretHint ?? ''}
              error={errors[field.key]}
              help={adapter.secretHint ? 'Deixe em branco para manter o valor salvo.' : undefined}
              onChange={(event) => {
                setSecrets((current) => ({ ...current, [field.key]: event.target.value }));
              }}
            />
          ))}
          {formError ? <Alert tone="error">{formError}</Alert> : null}
          <Button type="submit" loading={save.isPending}>
            Salvar
          </Button>
        </form>
      ) : (
        <p className="font-small text-small text-ink-muted">Este provedor não exige credenciais.</p>
      )}

      <CopyField label="URL do webhook" value={adapter.webhookUrl} />

      <div className="space-y-space-sm border-t border-hairline pt-space-md">
        <div className="flex flex-wrap gap-space-sm">
          <Button variant="secondary" loading={test.isPending} onClick={runTest}>
            Testar conexão
          </Button>
          <Button
            variant="secondary"
            disabled={!canActivate}
            onClick={() => {
              setActivateError(null);
              setConfirming(true);
            }}
          >
            Ativar
          </Button>
        </div>
        {result ? <Alert tone={result.ok ? 'success' : 'error'}>{result.message}</Alert> : null}
        {testError ? <Alert tone="error">{testError}</Alert> : null}
      </div>

      <Modal
        open={confirming}
        onClose={() => {
          setConfirming(false);
        }}
        title={`Ativar ${adapter.label}`}
      >
        <p className="font-body text-body text-ink">
          Novas cobranças passam a ser feitas por este provedor. As cobranças já criadas continuam
          no provedor original. Clientes com renovação automática em cartão de outro provedor
          recebem um e-mail para cadastrar o cartão de novo.
        </p>
        {activateError ? (
          <Alert tone="error" className="mt-space-md">
            {activateError}
          </Alert>
        ) : null}
        <div className="mt-space-lg flex flex-wrap justify-end gap-space-sm">
          <Button
            variant="secondary"
            onClick={() => {
              setConfirming(false);
            }}
          >
            Cancelar
          </Button>
          <Button
            loading={activate.isPending}
            onClick={() => {
              activate.mutate(undefined, {
                onSuccess: () => {
                  setConfirming(false);
                  toast({ message: `${adapter.label} ativado.` });
                },
                onError: (error) => {
                  setActivateError(messageOf(error, 'Não foi possível ativar o provedor.'));
                },
              });
            }}
          >
            Ativar provedor
          </Button>
        </div>
      </Modal>
    </section>
  );
}

/** Pagamentos tab: provider cards with credentials, test and activation (GES-35..GES-41). */
export function PaymentsTab() {
  const gateway = useGateway();

  if (gateway.isPending) return <Spinner label="Carregando os provedores" />;
  if (gateway.isError) {
    return (
      <Alert tone="error">
        <p>{messageOf(gateway.error, 'Não foi possível carregar os provedores de pagamento.')}</p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-space-sm"
          onClick={() => {
            void gateway.refetch();
          }}
        >
          Tentar novamente
        </Button>
      </Alert>
    );
  }

  return (
    <div className="space-y-space-lg">
      {gateway.data.productionWarning ? (
        <Alert tone="error">
          <p className="font-medium">Pagamentos em modo de teste</p>
          <p>
            O gateway ativo é o simulado ou está em ambiente de teste: nenhuma cobrança real será
            feita. Ative um provedor em produção antes de vender.
          </p>
        </Alert>
      ) : null}
      {gateway.data.adapters.map((adapter) => (
        <ProviderCard
          key={adapter.provider}
          adapter={adapter}
          active={adapter.provider === gateway.data.activeProvider}
        />
      ))}
    </div>
  );
}

import { utcToLocal } from '@bravo/core';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { useCsvDownload } from '../../components/ui/Table';
import { useToast } from '../../components/ui/Toast';
import { consentLabel } from '../../features/admin-customers/format';
import { DATA_EXPORT_URL, useConsents } from '../../features/privacy/api';
import { DeleteAccountModal } from '../../features/privacy/DeleteAccountModal';
import { messageOf } from '../../lib/api-errors';
import { formatLocalDateBR } from '../../lib/format';
import { usePageTitle } from '../../lib/usePageTitle';

const acceptedOn = (acceptedAt: string): string =>
  formatLocalDateBR(utcToLocal(new Date(acceptedAt)).date);

/** `/app/perfil/privacidade`: consents, data export and account deletion (GES-128). */
export function PrivacyPage() {
  usePageTitle('Privacidade');
  const navigate = useNavigate();
  const { toast } = useToast();
  const consents = useConsents();
  const exporter = useCsvDownload();
  const [deleting, setDeleting] = useState(false);

  const exportData = () => {
    void exporter.download(DATA_EXPORT_URL, `bravo-meus-dados-${utcToLocal(new Date()).date}.json`);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-space-xl">
      <h1 className="font-heading text-heading-mobile text-ink md:text-heading">
        Privacidade e dados
      </h1>

      <section aria-labelledby="consents-title" className="space-y-space-sm">
        <h2 id="consents-title" className="font-body text-body font-semibold text-ink">
          Seus aceites
        </h2>
        {consents.isPending ? <Spinner label="Carregando aceites" /> : null}
        {consents.isError ? (
          <Alert tone="error">Não foi possível carregar seus aceites agora.</Alert>
        ) : null}
        {consents.isSuccess && consents.data.items.length === 0 ? (
          <p className="font-small text-small text-ink-muted">Nenhum aceite registrado.</p>
        ) : null}
        <ul className="space-y-space-xs">
          {consents.data?.items.map((consent) => (
            <li
              key={consent.id}
              className="flex flex-wrap items-baseline justify-between gap-space-sm rounded-card border border-hairline bg-surface-raised px-space-md py-space-sm"
            >
              <span className="font-body text-body text-ink">{consentLabel(consent.kind)}</span>
              <span className="font-small text-small text-ink-muted">
                {`Versão ${consent.version} · ${acceptedOn(consent.acceptedAt)}`}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="export-title" className="space-y-space-sm">
        <h2 id="export-title" className="font-body text-body font-semibold text-ink">
          Seus dados
        </h2>
        <p className="font-small text-small text-ink-muted">
          Baixe um arquivo com seu perfil, reservas, pagamentos, assinaturas e demais registros.
        </p>
        {exporter.error ? (
          <Alert tone="error">
            {messageOf(exporter.error, 'Não foi possível baixar seus dados agora.')}
          </Alert>
        ) : null}
        <Button variant="secondary" loading={exporter.pending} onClick={exportData}>
          Baixar meus dados
        </Button>
      </section>

      <section aria-labelledby="delete-title" className="space-y-space-sm">
        <h2 id="delete-title" className="font-body text-body font-semibold text-ink">
          Excluir conta
        </h2>
        <p className="font-small text-small text-ink-muted">
          Apaga seus dados pessoais. Reservas e pagamentos continuam registrados sem identificar
          você.
        </p>
        <Button
          variant="secondary"
          onClick={() => {
            setDeleting(true);
          }}
        >
          Excluir minha conta
        </Button>
      </section>

      <Button asChild variant="ghost" size="sm">
        <Link to="/app/perfil">Voltar ao perfil</Link>
      </Button>

      {deleting ? (
        <DeleteAccountModal
          onClose={() => {
            setDeleting(false);
          }}
          onDone={() => {
            setDeleting(false);
            toast({ message: 'Sua conta foi excluída.' });
            void navigate('/', { replace: true });
          }}
        />
      ) : null}
    </div>
  );
}

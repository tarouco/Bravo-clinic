import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { whatsappHref } from '../../components/layout/WhatsAppButton';
import { Badge } from '../../components/ui/Badge';
import { Eyebrow } from '../../components/ui/Brand';
import { Button } from '../../components/ui/Button';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { formatServicePrice } from '../../features/admin-extras/labels';
import { usePublicExtraServices } from '../../features/extras/api';
import { QuoteRequestForm } from '../../features/extras/QuoteRequestForm';
import { useClinicConfig } from '../../features/config/useClinicConfig';
import { usePageTitle } from '../../lib/usePageTitle';

/** `/servicos-extras`: active services with their reference price and the quote form (GES-87). */
export function ExtrasPage() {
  usePageTitle('Serviços extras');
  const services = usePublicExtraServices();
  const { whatsappE164 } = useClinicConfig();
  const [serviceId, setServiceId] = useState<string | undefined>(undefined);
  const formRef = useRef<HTMLElement>(null);

  const choose = (id: string) => {
    setServiceId(id);
    formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    formRef.current?.focus();
  };

  return (
    <section className="mx-auto max-w-7xl space-y-space-2xl px-gutter py-space-3xl">
      <div className="max-w-3xl space-y-space-xs">
        <Eyebrow>SERVIÇOS EXTRAS</Eyebrow>
        <h1 className="font-display-l-mobile text-display-l-mobile text-ink md:font-display-l md:text-display-l">
          Serviços extras
        </h1>
        <p className="font-body text-body text-ink-muted">
          Equipe para gravar seus procedimentos, editar vídeos e gerenciar campanhas. Os valores são
          referenciais; o orçamento final depende do que você precisa.
        </p>
      </div>

      {services.isPending ? <Spinner label="Carregando serviços" /> : null}
      {services.isError ? (
        <Alert tone="error">Não foi possível carregar os serviços agora.</Alert>
      ) : null}
      {services.data?.items.length === 0 ? (
        <Alert>Nenhum serviço disponível no momento. Fale com a recepção pelo WhatsApp.</Alert>
      ) : null}

      <ul className="grid grid-cols-1 gap-space-xl md:grid-cols-3">
        {services.data?.items.map((service) => (
          <li
            key={service.id}
            className="flex flex-col justify-between gap-space-md rounded-xl bg-surface-raised p-space-xl shadow-md"
          >
            <div className="space-y-space-sm">
              {service.saleMode === 'online' ? <Badge>Contratação online</Badge> : null}
              <h2 className="font-heading-mobile text-heading-mobile text-ink md:font-heading md:text-heading">
                {service.name}
              </h2>
              {service.description ? (
                <p className="font-small text-small text-ink-muted">{service.description}</p>
              ) : null}
              <p className="rounded bg-surface p-space-sm font-body text-body font-semibold text-bronze">
                {formatServicePrice(service.referencePriceCents, service.unit)}
              </p>
              {service.saleMode === 'online' ? (
                <p className="font-small text-small text-ink-muted">
                  Adicione ao{' '}
                  <Link className="underline underline-offset-4" to="/reservar">
                    reservar uma sala
                  </Link>
                  .
                </p>
              ) : null}
            </div>
            <Button
              variant="secondary"
              aria-label={`Solicitar orçamento de ${service.name}`}
              onClick={() => {
                choose(service.id);
              }}
            >
              Solicitar orçamento
            </Button>
          </li>
        ))}
      </ul>

      <section
        ref={formRef}
        tabIndex={-1}
        aria-labelledby="pedido-orcamento"
        className="mx-auto max-w-xl space-y-space-md rounded-card bg-surface-raised p-space-lg focus:outline-none"
      >
        <h2
          id="pedido-orcamento"
          className="font-heading-mobile text-heading-mobile text-ink md:font-heading md:text-heading"
        >
          Peça seu orçamento
        </h2>
        <QuoteRequestForm
          serviceId={serviceId}
          footer={
            whatsappE164 ? (
              <p className="font-small text-small text-ink-muted">
                Prefere conversar?{' '}
                <a
                  className="text-bronze underline underline-offset-4 hover:text-walnut"
                  href={whatsappHref(whatsappE164)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Fale pelo WhatsApp
                </a>
                .
              </p>
            ) : null
          }
        />
      </section>
    </section>
  );
}

import { minuteToHHMM } from '@bravo/core';
import { Clock, Mail, MapPin, MessageCircle } from 'lucide-react';
import { Eyebrow } from '../../components/ui/Brand';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/Icon';
import { whatsappHref } from '../../components/layout/WhatsAppButton';
import { useClinic } from '../../features/catalog/api';
import { usePageTitle } from '../../lib/usePageTitle';

export const MAPS_URL =
  'https://www.google.com/maps/search/?api=1&query=Praia%20Brava%2C%20Itaja%C3%AD%20-%20SC';

const DAY_LABEL = {
  mon: 'Segunda-feira',
  tue: 'Terça-feira',
  wed: 'Quarta-feira',
  thu: 'Quinta-feira',
  fri: 'Sexta-feira',
  sat: 'Sábado',
  sun: 'Domingo',
  holiday: 'Feriados',
} as const;

const linkClasses = 'text-accent underline underline-offset-4 hover:text-accent-deep';

/** `/contato`: address, WhatsApp, e-mail when set, opening hours per day and the Maps link. */
export function ContactPage() {
  usePageTitle('Contato');
  const { data, isPending, isError } = useClinic();

  return (
    <section className="mx-auto max-w-3xl space-y-space-xl px-gutter py-space-3xl">
      <div className="space-y-space-xs">
        <Eyebrow>Fale com a clínica</Eyebrow>
        <h1 className="font-display text-display-l-mobile text-ink md:text-display-l">Contato</h1>
      </div>

      {isPending ? (
        <Spinner label="Carregando contato" />
      ) : isError ? (
        <Alert tone="error">Não foi possível carregar os dados de contato agora.</Alert>
      ) : (
        <div className="bv-card space-y-space-lg font-body text-body text-ink-muted sm:p-space-xl">
          <p className="flex items-start gap-space-sm">
            <Icon as={MapPin} className="mt-1 shrink-0 text-accent" />
            <span>
              {data.addressLine}
              <br />
              <a href={MAPS_URL} target="_blank" rel="noopener noreferrer" className={linkClasses}>
                Abrir no Google Maps
              </a>
            </span>
          </p>
          <p className="flex items-start gap-space-sm">
            <Icon as={MessageCircle} className="mt-1 shrink-0 text-accent" />
            <a
              href={whatsappHref(data.whatsappE164)}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClasses}
            >
              Falar no WhatsApp
            </a>
          </p>
          {data.contactEmail ? (
            <p className="flex items-start gap-space-sm">
              <Icon as={Mail} className="mt-1 shrink-0 text-accent" />
              <a href={`mailto:${data.contactEmail}`} className={linkClasses}>
                {data.contactEmail}
              </a>
            </p>
          ) : null}
          <div className="flex items-start gap-space-sm">
            <Icon as={Clock} className="mt-1 shrink-0 text-accent" />
            <div className="w-full">
              <h2 className="bv-card-title">Horário de funcionamento</h2>
              <dl className="divide-y divide-hairline overflow-hidden rounded-md bg-surface-deboss shadow-deboss">
                {data.businessHours.map((row) => (
                  <div
                    key={row.dayType}
                    className="flex justify-between gap-space-md px-5 py-space-sm"
                  >
                    <dt>{DAY_LABEL[row.dayType]}</dt>
                    <dd className="text-ink">
                      {row.isClosed
                        ? 'Fechado'
                        : `${minuteToHHMM(row.openMinute)} às ${minuteToHHMM(row.closeMinute)}`}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

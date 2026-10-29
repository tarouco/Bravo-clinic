import {
  Banknote,
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarSync,
  History,
  MessageCircle,
  RefreshCw,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { whatsappHref } from '../../../components/layout/WhatsAppButton';
import { Eyebrow } from '../../../components/ui/Brand';
import { buttonClasses } from '../../../components/ui/Button';
import { cx } from '../../../components/ui/cx';
import { Icon } from '../../../components/ui/Icon';
import { useClinicConfig } from '../../../features/config/useClinicConfig';
import { EmeraldSilk } from '../EmeraldSilk';

const AMENITIES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Building2,
    title: 'Endereço nobre',
    text: 'Na Praia Brava, em Itajaí – SC, com fácil estacionamento.',
  },
  {
    icon: Wifi,
    title: 'Conectividade & café',
    text: 'Link de internet redundante para gravações e telemedicina, com lounge executivo e café.',
  },
  {
    icon: CalendarSync,
    title: 'Sincronização pessoal',
    text: 'Aplicativo da Bravô sincroniza suas reservas com seu Google Calendar e MS Outlook de forma imediata.',
  },
  {
    icon: CalendarClock,
    title: '1 reagendamento grátis',
    text: 'Imprevistos acontecem: 1 reagendamento cortesia self-service disponível até 24h antes da locação.',
  },
];

export function AmenitiesSection() {
  return (
    <section className="w-full bg-surface py-space-3xl">
      <div className="max-w-7xl mx-auto px-gutter">
        <div className="mb-space-2xl max-w-3xl space-y-space-sm">
          <Eyebrow>Comodidade de operação</Eyebrow>
          <h2 className="font-display text-display-l-mobile text-ink md:text-display-l">
            Estrutura completa para você focar no atendimento.
          </h2>
          <p className="font-body text-body text-ink-muted">
            Do momento em que seu paciente entra em nossa recepção até a emissão do convite no
            Google Calendar, cada etapa foi minuciosamente calculada.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-space-lg">
          {AMENITIES.map((amenity) => (
            <div key={amenity.title} className="bv-card space-y-space-xs">
              <Icon as={amenity.icon} size={30} className="text-accent" />
              <h4 className="bv-card-title">{amenity.title}</h4>
              <p className="font-small text-small text-ink-muted">{amenity.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PolicyCard({
  icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="bv-card space-y-space-xs">
      <div className="flex items-center gap-space-xs text-ink">
        <Icon as={icon} size={18} className="shrink-0 text-accent" />
        <h3 className="bv-card-title m-0">{title}</h3>
      </div>
      <p className="font-small text-small text-ink-muted">{children}</p>
    </div>
  );
}

export function PoliciesSection() {
  return (
    <section className="w-full py-space-3xl bg-surface">
      <div className="max-w-7xl mx-auto px-gutter">
        <div className="bv-panel p-space-lg md:p-space-2xl">
          <div className="mb-space-xl max-w-3xl space-y-space-sm">
            <Eyebrow>Transparência total</Eyebrow>
            <h2 className="font-display text-display-l-mobile text-ink md:text-display-l">
              Políticas de reserva, sinal e cancelamento
            </h2>
            <p className="font-body text-body text-ink-muted">
              Resumo das cláusulas do termo de locação conforme o manual operacional da clínica:
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-space-lg">
            <PolicyCard icon={Banknote} title="Sinal de 50%">
              Cobrado no ato da reserva para garantir o horário. O sinal{' '}
              <strong>não é reembolsável</strong> em caso de desistência.
            </PolicyCard>
            <PolicyCard icon={History} title="Saldo 48h antes">
              Os 50% restantes são cobrados automaticamente no cartão tokenizado ou via Pix 48h
              antes da sessão. O prazo final para quitação é 24h antes, sob pena de cancelamento da
              reserva.
            </PolicyCard>
            <PolicyCard icon={RefreshCw} title="Reagendamento cortesia">
              Você tem direito a <strong>1 reagendamento cortesia self-service</strong> com
              antecedência igual ou superior a 24 horas, transferindo a reserva para qualquer janela
              disponível.
            </PolicyCard>
          </div>
        </div>
      </div>
    </section>
  );
}

export function LaunchCtaSection() {
  const { whatsappE164 } = useClinicConfig();

  // The section's one colored card: emerald with the silk wave, gold title, on-emerald text.
  return (
    <section className="w-full bg-surface py-space-3xl">
      <div className="mx-auto max-w-5xl px-gutter">
        <div className="bv-card bv-card--emerald px-space-lg py-space-2xl text-center md:px-space-2xl">
          <div className="relative z-10 space-y-space-lg">
            <span className="block font-eyebrow text-eyebrow uppercase text-gold">
              Pré-lançamento exclusivo
            </span>
            <h2 className="font-display text-display-l-mobile text-gold md:text-display-l">
              Pronto para elevar o padrão dos seus atendimentos?
            </h2>
            <p className="mx-auto max-w-2xl font-lead text-lead text-on-emerald/90">
              Junte-se à seleta comunidade de médicos, esteticistas e profissionais de bem-estar que
              operam sem o peso de custos imobiliários na Praia Brava.
            </p>
            <div className="flex flex-col items-center justify-center gap-space-md pt-space-md sm:flex-row">
              <a
                className={cx(buttonClasses({ variant: 'gold' }), 'w-full sm:w-auto')}
                href="#simulador"
              >
                <Icon as={CalendarDays} size={18} />
                <span>Reservar horário agora</span>
              </a>
              <a
                className={cx(buttonClasses({ variant: 'secondary' }), 'w-full sm:w-auto')}
                href={whatsappHref(whatsappE164)}
                rel="noopener noreferrer"
                target="_blank"
              >
                <Icon as={MessageCircle} size={18} className="text-accent" />
                <span>Tirar dúvidas com a recepção</span>
              </a>
            </div>
          </div>
          <EmeraldSilk />
        </div>
      </div>
    </section>
  );
}

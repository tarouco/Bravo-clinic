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
import { focusRing } from '../../../components/ui/cx';
import { Icon } from '../../../components/ui/Icon';
import { useClinicConfig } from '../../../features/config/useClinicConfig';

const AMENITIES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Building2,
    title: 'Endereço Nobre',
    text: 'Na Praia Brava, em Itajaí – SC, com fácil estacionamento.',
  },
  {
    icon: Wifi,
    title: 'Conectividade & Café',
    text: 'Link de internet redundante para gravações e telemedicina, com lounge executivo e café.',
  },
  {
    icon: CalendarSync,
    title: 'Sincronização Pessoal',
    text: 'Aplicativo da Bravô sincroniza suas reservas com seu Google Calendar e MS Outlook de forma imediata.',
  },
  {
    icon: CalendarClock,
    title: '1 Reagendamento Grátis',
    text: 'Imprevistos acontecem: 1 reagendamento cortesia self-service disponível até 24h antes da locação.',
  },
];

export function AmenitiesSection() {
  return (
    <section className="w-full py-space-3xl bg-surface-container-low">
      <div className="max-w-7xl mx-auto px-gutter">
        <div className="max-w-3xl mb-space-2xl">
          <Eyebrow>COMODIDADE DE OPERAÇÃO</Eyebrow>
          <h2 className="font-display-l-mobile text-display-l-mobile md:font-display-l md:text-display-l text-ink">
            Estrutura completa para você focar no atendimento.
          </h2>
          <p className="font-body text-body text-ink-muted">
            Do momento em que seu paciente entra em nossa recepção até a emissão do convite no
            Google Calendar, cada etapa foi minuciosamente calculada.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-space-lg">
          {AMENITIES.map((amenity) => (
            <div
              key={amenity.title}
              className="p-space-lg bg-surface-raised rounded-xl shadow-sm space-y-space-xs"
            >
              <Icon as={amenity.icon} size={30} className="text-bronze" />
              <h4 className="font-heading text-body font-semibold text-ink">{amenity.title}</h4>
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
    <div className="space-y-space-xs bg-surface p-space-md rounded-lg">
      <div className="flex items-center gap-space-xs text-bronze font-semibold font-eyebrow text-caption uppercase">
        <Icon as={icon} size={18} className="shrink-0" />
        <span>{title}</span>
      </div>
      <p className="font-small text-small text-ink-muted">{children}</p>
    </div>
  );
}

export function PoliciesSection() {
  return (
    <section className="w-full py-space-3xl bg-surface">
      <div className="max-w-7xl mx-auto px-gutter">
        <div className="bg-surface-raised rounded-2xl p-space-xl md:p-space-2xl shadow-xl border-l-4 border-bronze">
          <div className="max-w-3xl mb-space-xl">
            <Eyebrow>TRANSPARÊNCIA TOTAL</Eyebrow>
            <h2 className="font-display-l text-heading text-ink">
              Políticas de Reserva, Sinal e Cancelamento
            </h2>
            <p className="font-body text-body text-ink-muted mt-space-xs">
              Resumo das cláusulas do termo de locação conforme o manual operacional da clínica:
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-space-lg">
            <PolicyCard icon={Banknote} title="Sinal de 50%">
              Cobrado no ato da reserva para garantir o horário. O sinal{' '}
              <strong>não é reembolsável</strong> em caso de desistência.
            </PolicyCard>
            <PolicyCard icon={History} title="Saldo 48h Antes">
              Os 50% restantes são cobrados automaticamente no cartão tokenizado ou via Pix 48h
              antes da sessão. O prazo final para quitação é 24h antes, sob pena de cancelamento da
              reserva.
            </PolicyCard>
            <PolicyCard icon={RefreshCw} title="Reagendamento Cortesia">
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

  return (
    <section className="w-full py-space-3xl bg-surface-container-high relative overflow-hidden">
      <div className="max-w-5xl mx-auto px-gutter text-center space-y-space-lg relative z-10">
        <span className="font-eyebrow text-caption uppercase tracking-[0.32em] text-bronze font-semibold">
          PRÉ-LANÇAMENTO EXCLUSIVO
        </span>
        <h2 className="font-display-xl text-heading md:text-display-l text-ink">
          Pronto para elevar o padrão dos seus atendimentos?
        </h2>
        <p className="font-lead text-lead text-ink-muted max-w-2xl mx-auto">
          Junte-se à seleta comunidade de médicos, esteticistas e profissionais de bem-estar que
          operam sem o peso de custos imobiliários na Praia Brava.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-space-md pt-space-md">
          <a
            className={`w-full sm:w-auto inline-flex items-center justify-center gap-space-xs px-space-2xl py-space-md bg-bronze hover:bg-walnut text-on-bronze font-small text-small uppercase tracking-[0.08em] rounded shadow-md transition-all ${focusRing}`}
            href="#simulador"
          >
            <Icon as={CalendarDays} size={18} />
            <span>Reservar Horário Agora</span>
          </a>
          <a
            className={`w-full sm:w-auto inline-flex items-center justify-center gap-space-xs px-space-2xl py-space-md bg-surface-raised hover:bg-surface-stone text-ink font-small text-small uppercase tracking-[0.08em] rounded shadow-sm transition-all ${focusRing}`}
            href={whatsappHref(whatsappE164)}
            rel="noopener noreferrer"
            target="_blank"
          >
            <Icon as={MessageCircle} size={18} className="text-bronze" />
            <span>Tirar Dúvidas com Recepção</span>
          </a>
        </div>
      </div>
    </section>
  );
}

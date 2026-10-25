import { ArrowRight, BadgeCheck, Calendar, Lock, SearchCheck, SprayCan } from 'lucide-react';
import { useState } from 'react';
import { focusRing } from '../../../components/ui/cx';
import { Icon } from '../../../components/ui/Icon';
import { isRoomSlug, type RoomSlug } from '../../../features/home/room-slug';

export interface HeroSectionProps {
  selectedRoom: RoomSlug;
  onRoomChange: (slug: RoomSlug) => void;
  /** "Verificar Horários": the page scrolls to the simulator. */
  onCheck: () => void;
}

const ROOM_OPTIONS: { value: RoomSlug; label: string }[] = [
  { value: 'principal', label: 'Sala Principal (Estética, Médico & Gravação)' },
  { value: 'secundaria', label: 'Sala Secundária (Médico, Estética & Vídeos)' },
  { value: 'terceira', label: 'Sala Terceira (Massagem, Terapias & Spa)' },
];

const MODALITY_OPTIONS = [
  { value: 'avulsa', label: 'Por Hora (mín. 1h)' },
  { value: 'meio-turno', label: 'Meio Turno (Bloco fixo 2h30)' },
  { value: 'turno', label: 'Turno Completo (5h)' },
  { value: 'noite', label: 'Período Noturno (19h às 00h)' },
];

const labelClasses =
  'block font-eyebrow text-caption uppercase text-ink-muted mb-space-xs tracking-[0.16em]';

/** Today as `YYYY-MM-DD` in the visitor's local time zone (the default of the date field). */
function todayLocalIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${String(now.getFullYear())}-${month}-${day}`;
}

export function HeroSection({ selectedRoom, onRoomChange, onCheck }: HeroSectionProps) {
  const [today] = useState(todayLocalIso);

  return (
    <section className="relative w-full overflow-hidden bg-surface pb-space-3xl">
      <div className="absolute inset-0 bg-gradient-to-b from-champagne-soft/25 via-transparent to-surface pointer-events-none" />
      <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-champagne/15 blur-3xl pointer-events-none" />
      <div className="max-w-7xl mx-auto px-gutter relative z-10 pt-space-xl">
        <div className="flex flex-col items-center text-center space-y-space-sm mb-space-lg">
          <div className="inline-flex items-center gap-space-sm px-space-md py-space-xs rounded-full bg-surface-raised shadow-sm text-ink-muted">
            <span className="w-1.5 h-1.5 rounded-full bg-bronze" />
            <span className="font-eyebrow text-eyebrow uppercase tracking-[0.32em] text-bronze font-medium">
              SALAS INTELIGENTES SOB DEMANDA
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-bronze" />
          </div>
          <h1 className="font-display-xl-mobile text-display-xl-mobile md:font-display-xl md:text-display-xl text-ink max-w-4xl tracking-tight mt-space-sm">
            Saúde, beleza e bem-estar em um só lugar.
          </h1>
          <p className="font-lead text-lead text-ink-muted max-w-2xl mx-auto">
            Consultórios inteligentes e estúdios clínicos na Praia Brava, em Itajaí, prontos para
            atender por hora, meio turno ou turno. Sem taxa de adesão, condomínio ou burocracia
            fixa.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-space-md pt-space-xs">
            <a
              className={`inline-flex items-center gap-space-xs bg-bronze hover:bg-walnut text-on-bronze font-small text-small uppercase tracking-[0.08em] px-space-xl py-space-md rounded shadow-md transition-all duration-300 ${focusRing}`}
              href="#simulador"
            >
              <span>Simular e Reservar</span>
              <Icon as={ArrowRight} size={16} />
            </a>
            <a
              className={`inline-flex items-center gap-space-xs bg-surface-raised hover:bg-surface-stone text-ink font-small text-small uppercase tracking-[0.08em] px-space-xl py-space-md rounded shadow-sm transition-all duration-300 ${focusRing}`}
              href="#salas"
            >
              <span>Conhecer as Salas</span>
            </a>
          </div>
        </div>

        <div className="w-full bg-surface-raised rounded-xl shadow-xl p-space-lg md:p-space-xl mt-space-lg">
          <div className="flex flex-col lg:flex-row items-stretch lg:items-end gap-space-md">
            <div className="flex-1 min-w-0">
              <label className={labelClasses} htmlFor="heroRoomSelect">
                1. Selecionar Consultório
              </label>
              <div className="relative bg-surface rounded px-space-md py-space-sm">
                <select
                  className="w-full bg-transparent text-ink font-body text-body focus:outline-none cursor-pointer"
                  id="heroRoomSelect"
                  value={selectedRoom}
                  onChange={(event) => {
                    if (isRoomSlug(event.target.value)) onRoomChange(event.target.value);
                  }}
                >
                  {ROOM_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <label className={labelClasses} htmlFor="heroDateInput">
                2. Data do Atendimento
              </label>
              <div className="relative bg-surface rounded px-space-md py-space-sm flex items-center">
                <Icon as={Calendar} size={18} className="text-bronze mr-space-xs shrink-0" />
                <input
                  className="w-full bg-transparent text-ink font-body text-body focus:outline-none cursor-pointer"
                  id="heroDateInput"
                  type="date"
                  defaultValue={today}
                  min={today}
                />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <label className={labelClasses} htmlFor="heroModalidadeSelect">
                3. Modalidade / Formato
              </label>
              <div className="relative bg-surface rounded px-space-md py-space-sm">
                <select
                  className="w-full bg-transparent text-ink font-body text-body focus:outline-none cursor-pointer"
                  id="heroModalidadeSelect"
                  defaultValue="avulsa"
                >
                  {MODALITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex-none">
              <button
                type="button"
                className={`w-full lg:w-auto h-[48px] px-space-xl bg-bronze hover:bg-walnut text-on-bronze font-small text-small uppercase tracking-[0.08em] rounded inline-flex items-center justify-center gap-space-xs shadow-md transition-all ${focusRing}`}
                onClick={onCheck}
              >
                <Icon as={SearchCheck} size={18} />
                <span>Verificar Horários</span>
              </button>
            </div>
          </div>
          <div className="pt-space-md mt-space-md flex flex-wrap items-center justify-between gap-space-md text-ink-muted font-caption text-caption">
            <div className="flex items-center gap-space-xs">
              <Icon as={BadgeCheck} size={16} className="text-bronze shrink-0" />
              <span>Sem fidelidade: pague apenas pelo tempo de uso reservado</span>
            </div>
            <div className="flex items-center gap-space-xs">
              <Icon as={SprayCan} size={16} className="text-bronze shrink-0" />
              <span>Bloqueio de limpeza de 30 min automático e sem custo após cada sessão</span>
            </div>
            <div className="flex items-center gap-space-xs">
              <Icon as={Lock} size={16} className="text-bronze shrink-0" />
              <span>Sinal de 50% seguro via Mercado Pago (Pix ou Cartão)</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

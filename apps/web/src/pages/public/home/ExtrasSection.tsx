import { Clapperboard, Film, Megaphone, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Eyebrow } from '../../../components/ui/Brand';
import { focusRing } from '../../../components/ui/cx';
import { Icon } from '../../../components/ui/Icon';
import { QuoteModal, type QuoteTarget } from './QuoteModal';

interface ExtraService {
  icon: LucideIcon;
  chip: string;
  title: string;
  /** Name used in the quote modal title and in the WhatsApp message. */
  quoteTitle: string;
  /** Finds this service in the API catalog (`/api/public/extra-services`) to preselect it. */
  quoteMatch: RegExp;
  description: string;
  priceCaption: string;
  price: ReactNode;
}

const EXTRAS: ExtraService[] = [
  {
    icon: Clapperboard,
    chip: 'Disponível em qualquer sala',
    title: 'Pacote Filmagem & Gravação',
    quoteTitle: 'Pacote de Filmagem & Gravação',
    quoteMatch: /filmagem/i,
    description:
      'Cenário ajustado, iluminação profissional estroboscópica e contínua, microfonação lapela sem fio e captação em 4K. Ideal para procedimentos estéticos e podcasts de saúde.',
    priceCaption: 'Valor referencial sugerido',
    price: (
      <span className="font-heading-mobile text-heading-mobile md:font-heading md:text-heading text-bronze font-semibold">
        R$ 80,00<span className="font-body text-small text-ink-muted font-normal">/hora</span>
      </span>
    ),
  },
  {
    icon: Film,
    chip: 'Operador Dedicado',
    title: 'Videomaker Dedicado',
    quoteTitle: 'Videomaker Dedicado',
    quoteMatch: /videomaker/i,
    description:
      'Profissional no local operando câmeras, enquadramentos dinâmicos em macro de procedimentos e entrega de arquivos brutos ou cortes prontos no formato Reels e TikTok.',
    priceCaption: 'Orçamento personalizado',
    price: (
      <span className="font-body text-body text-ink font-semibold">Sob consulta de turnos</span>
    ),
  },
  {
    icon: Megaphone,
    chip: 'Captação de Pacientes',
    title: 'Marketing para Saúde',
    quoteTitle: 'Marketing Digital para Saúde & Estética',
    quoteMatch: /marketing/i,
    description:
      'Estratégias de tráfego pago geolocalizado na Praia Brava, Itajaí e região para médicos, esteticistas e terapeutas com foco em conversão no WhatsApp.',
    priceCaption: 'Gestão completa',
    price: (
      <span className="font-body text-body text-ink font-semibold">Planos de Crescimento</span>
    ),
  },
];

export function ExtrasSection() {
  const [quoteService, setQuoteService] = useState<QuoteTarget | null>(null);

  return (
    <section className="w-full py-space-3xl bg-surface">
      <div className="max-w-7xl mx-auto px-gutter">
        <div className="text-center max-w-3xl mx-auto mb-space-2xl space-y-space-xs">
          <Eyebrow>SERVIÇOS EXTRAS</Eyebrow>
          <h2 className="font-display-l-mobile text-display-l-mobile md:font-display-l md:text-display-l text-ink">
            Potencialize sua marca e captação de clientes.
          </h2>
          <p className="font-body text-body text-ink-muted">
            Além da locação por hora, disponibilizamos equipe especializada para gravar seus
            procedimentos, editar vídeos para redes sociais e gerenciar suas campanhas de tráfego.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-space-xl">
          {EXTRAS.map((extra) => (
            <article
              key={extra.title}
              className="bg-surface-raised rounded-xl p-space-xl shadow-md flex flex-col justify-between"
            >
              <div className="space-y-space-md">
                <div className="w-12 h-12 rounded-full bg-champagne-soft text-bronze flex items-center justify-center">
                  <Icon as={extra.icon} size={24} />
                </div>
                <div>
                  <span className="font-caption text-caption uppercase tracking-wider text-bronze font-semibold">
                    {extra.chip}
                  </span>
                  <h3 className="font-heading-mobile text-heading-mobile md:font-heading md:text-heading text-ink mt-1">
                    {extra.title}
                  </h3>
                </div>
                <p className="font-small text-small text-ink-muted">{extra.description}</p>
                <div className="p-space-sm bg-surface rounded">
                  <span className="font-caption text-caption text-ink-muted block">
                    {extra.priceCaption}
                  </span>
                  {extra.price}
                </div>
              </div>
              <button
                type="button"
                className={`mt-space-lg w-full py-space-sm bg-surface hover:bg-surface-stone text-ink font-small text-small uppercase tracking-wider rounded transition-colors text-center ${focusRing}`}
                onClick={() => {
                  setQuoteService({ title: extra.quoteTitle, match: extra.quoteMatch });
                }}
              >
                Solicitar Orçamento
              </button>
            </article>
          ))}
        </div>
      </div>
      <QuoteModal
        service={quoteService}
        onClose={() => {
          setQuoteService(null);
        }}
      />
    </section>
  );
}

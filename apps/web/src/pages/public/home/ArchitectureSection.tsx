import { Flower2, Video } from 'lucide-react';
import { Icon } from '../../../components/ui/Icon';

export function ArchitectureSection() {
  return (
    <section className="w-full py-space-2xl bg-surface-container-low scroll-mt-20" id="estrutura">
      <div className="max-w-7xl mx-auto px-gutter">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-xl items-center">
          <div className="lg:col-span-5 space-y-space-md">
            <span className="font-eyebrow text-caption uppercase tracking-[0.28em] text-bronze block">
              ARQUITETURA HOSPITALAR SENSORIAL
            </span>
            <h2 className="font-display-l-mobile text-display-l-mobile md:font-display-l md:text-display-l text-ink">
              A extensão natural da sua autoridade clínica.
            </h2>
            <p className="font-body text-body text-ink-muted">
              Projetada sob preceitos de biofilia e iluminação quente de 2700K, a Bravô Clinic
              neutraliza o estresse clássico de consultórios convencionais. Cada detalhe — do
              mármore travertino às macas articuladas de linha médica — comunica prestígio
              inquestionável ao seu paciente antes mesmo do primeiro cumprimento.
            </p>
            <div className="grid grid-cols-2 gap-space-md pt-space-xs">
              <div className="p-space-md bg-surface rounded shadow-sm">
                <div className="font-display-l text-heading text-bronze font-semibold">100%</div>
                <div className="font-small text-small text-ink-muted mt-1">
                  Conformidade e biossegurança RDC Anvisa
                </div>
              </div>
              <div className="p-space-md bg-surface rounded shadow-sm">
                <div className="font-display-l text-heading text-bronze font-semibold">07h-00h</div>
                <div className="font-small text-small text-ink-muted mt-1">
                  Abertos todos os dias, inclusive feriados
                </div>
              </div>
            </div>
          </div>
          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-space-md">
            <div className="space-y-space-md">
              <div className="relative overflow-hidden rounded-xl shadow-md h-72">
                <img
                  className="w-full h-full object-cover"
                  src="/images/recepcao.webp"
                  loading="lazy"
                  alt="Recepção boutique com a sinalização em bronze da Bravô Clinic, iluminada em tom champagne, na Praia Brava, Itajaí"
                />
                <div className="absolute bottom-3 left-3 bg-surface-night/70 backdrop-blur-md px-space-sm py-1 rounded text-ink-night font-caption text-caption">
                  Recepção Boutique Praia Brava
                </div>
              </div>
              <div className="p-space-md bg-surface-raised rounded-xl shadow-sm space-y-space-xs">
                <div className="flex items-center gap-space-xs text-bronze">
                  <Icon as={Flower2} size={18} />
                  <span className="font-eyebrow text-caption tracking-wider uppercase font-semibold">
                    Hospitalidade Real
                  </span>
                </div>
                <p className="font-small text-small text-ink-muted">
                  Recepcionista bilíngue para acolher seu paciente, servir cafés especiais e
                  realizar check-in cordial.
                </p>
              </div>
            </div>
            <div className="space-y-space-md sm:mt-space-lg">
              <div className="p-space-md bg-surface-raised rounded-xl shadow-sm space-y-space-xs">
                <div className="flex items-center gap-space-xs text-bronze">
                  <Icon as={Video} size={18} />
                  <span className="font-eyebrow text-caption tracking-wider uppercase font-semibold">
                    Acústica de Estúdio
                  </span>
                </div>
                <p className="font-small text-small text-ink-muted">
                  Salas preparadas para captação de áudio nítido e iluminação difusa adequada para
                  gravações e telemedicina.
                </p>
              </div>
              <div className="relative overflow-hidden rounded-xl shadow-md h-72">
                <img
                  className="w-full h-full object-cover"
                  src="/images/consultorio.webp"
                  loading="lazy"
                  alt="Consultório privativo com maca motorizada e mesa de pedra, em tons terrosos, na Praia Brava, Itajaí"
                />
                <div className="absolute bottom-3 left-3 bg-surface-night/70 backdrop-blur-md px-space-sm py-1 rounded text-ink-night font-caption text-caption">
                  Consultório Privativo
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

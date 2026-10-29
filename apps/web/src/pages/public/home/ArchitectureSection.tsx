import { Flower2, Video } from 'lucide-react';
import { Eyebrow } from '../../../components/ui/Brand';
import { Icon } from '../../../components/ui/Icon';

/** Pearl glass caption over a photo. */
const photoCaption =
  'absolute bottom-3 left-3 rounded-pill bg-surface-raised/90 px-3 py-1 font-caption text-caption text-ink shadow-lift-1 backdrop-blur-glass';

const featureCard = 'bv-card space-y-space-xs';

export function ArchitectureSection() {
  return (
    <section className="w-full scroll-mt-20 bg-surface py-space-2xl" id="estrutura">
      <div className="mx-auto max-w-7xl px-gutter">
        <div className="grid grid-cols-1 items-center gap-space-xl lg:grid-cols-12">
          <div className="space-y-space-md lg:col-span-5">
            <Eyebrow>Arquitetura hospitalar sensorial</Eyebrow>
            <h2 className="font-display text-display-l-mobile text-ink md:text-display-l">
              A extensão natural da sua autoridade clínica.
            </h2>
            <p className="font-body text-body text-ink-muted">
              Projetada sob preceitos de biofilia e iluminação quente de 2700K, a Bravô Clinic
              neutraliza o estresse clássico de consultórios convencionais. Cada detalhe — do
              mármore travertino às macas articuladas de linha médica — comunica prestígio
              inquestionável ao seu paciente antes mesmo do primeiro cumprimento.
            </p>
            <div className="grid grid-cols-2 gap-space-md pt-space-xs">
              <div className="rounded-md bg-surface-raised p-space-md shadow-lift-1">
                <div className="font-display text-heading text-accent">100%</div>
                <div className="mt-1 font-small text-small text-ink-muted">
                  Conformidade e biossegurança RDC Anvisa
                </div>
              </div>
              <div className="rounded-md bg-surface-raised p-space-md shadow-lift-1">
                <div className="font-display text-heading text-accent">07h-00h</div>
                <div className="mt-1 font-small text-small text-ink-muted">
                  Abertos todos os dias, inclusive feriados
                </div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:col-span-7">
            <div className="space-y-space-md">
              <div className="relative h-72 overflow-hidden rounded-lg shadow-lift-2">
                <img
                  className="h-full w-full object-cover"
                  src="/images/recepcao.webp"
                  loading="lazy"
                  alt="Recepção boutique com a sinalização em bronze da Bravô Clinic, iluminada em tom champagne, na Praia Brava, Itajaí"
                />
                <div className={photoCaption}>Recepção boutique Praia Brava</div>
              </div>
              <div className={featureCard}>
                <div className="flex items-center gap-space-xs text-ink">
                  <Icon as={Flower2} size={18} className="text-accent" />
                  <h3 className="bv-card-title m-0">Hospitalidade real</h3>
                </div>
                <p className="bv-card-text">
                  Recepcionista bilíngue para acolher seu paciente, servir cafés especiais e
                  realizar check-in cordial.
                </p>
              </div>
            </div>
            <div className="space-y-space-md sm:mt-space-lg">
              <div className={featureCard}>
                <div className="flex items-center gap-space-xs text-ink">
                  <Icon as={Video} size={18} className="text-accent" />
                  <h3 className="bv-card-title m-0">Acústica de estúdio</h3>
                </div>
                <p className="bv-card-text">
                  Salas preparadas para captação de áudio nítido e iluminação difusa adequada para
                  gravações e telemedicina.
                </p>
              </div>
              <div className="relative h-72 overflow-hidden rounded-lg shadow-lift-2">
                <img
                  className="h-full w-full object-cover"
                  src="/images/consultorio.webp"
                  loading="lazy"
                  alt="Consultório privativo com maca motorizada e mesa de pedra, em tons terrosos, na Praia Brava, Itajaí"
                />
                <div className={photoCaption}>Consultório privativo</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

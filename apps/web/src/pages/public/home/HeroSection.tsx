import { ArrowRight, BadgeCheck, Clock, Receipt } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Eyebrow } from '../../../components/ui/Brand';
import { buttonClasses } from '../../../components/ui/Button';
import { cx } from '../../../components/ui/cx';
import { Icon } from '../../../components/ui/Icon';
import { useMediaQueryOnce } from '../../../lib/useHydrated';
import { EmeraldSilk } from '../EmeraldSilk';

/** Pauses the mobile tour loop for visitors who asked the system for reduced motion. */
function useReducedMotionPause() {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video || typeof window.matchMedia !== 'function') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      video.removeAttribute('autoplay');
      try {
        video.pause();
      } catch {
        // jsdom and some embedded browsers do not implement media playback.
      }
    }
  }, []);
  return ref;
}

/**
 * The tour loop only exists below `md`, so wide screens never download it. Prerendered markup
 * (GES-143) carries the phone layout; wide screens drop the video once hydration ends.
 */
function useIsWideScreen(): boolean {
  return useMediaQueryOnce('(min-width: 768px)');
}

/** The three key facts: one gold card, one pearl card hanging past the panel, one emerald card. */
const HIGHLIGHTS = [
  { icon: Clock, label: 'Por hora, meio turno ou turno', tone: 'gold' },
  { icon: Receipt, label: 'Sem taxa de adesão', tone: 'pearl' },
  { icon: BadgeCheck, label: 'Sem condomínio ou burocracia fixa', tone: 'emerald' },
] as const;

const highlightCard = {
  gold: 'bv-card bv-card--gold',
  // The overhang only on wide screens: under 900px the grid stacks and nothing hangs (WebHero).
  pearl: 'bv-card lg:mr-[calc(var(--space-12)*-1)]',
  emerald: 'bv-card bv-card--emerald min-h-[148px]',
} as const;

const highlightIcon = {
  gold: 'text-on-gold',
  pearl: 'text-accent',
  emerald: 'text-gold',
} as const;

/**
 * The site's opening composition (guias/WebHero.md): a névoa stage, a translucent panel holding a
 * tall pearl hero card next to the flagship photo (a short vertical tour on phones), and the key
 * facts as a gold, a pearl and an emerald card. One emerald action; booking lives in the simulator.
 */
export function HeroSection() {
  const videoRef = useReducedMotionPause();
  const isWide = useIsWideScreen();

  return (
    <section className="relative isolate w-full overflow-hidden bg-surface px-4 pb-space-3xl pt-space-xl sm:px-gutter lg:pt-space-2xl">
      {/* Stage decoration, behind the panel and away from its text (WebHero). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 hidden lg:block"
      >
        <span className="absolute -top-10 right-[8%] h-60 w-60 rounded-full bg-[radial-gradient(circle,rgb(var(--c-gold-soft))_0%,rgb(var(--c-gold))_45%,rgb(var(--c-gold)/0)_70%)] dark:opacity-40" />
        <span className="absolute -left-10 top-10 h-36 w-36 rounded-full bg-[radial-gradient(circle_at_35%_30%,rgb(var(--c-surface-raised)),rgb(var(--c-border)/0.4)_70%)] shadow-lift-2 dark:opacity-15" />
        <span className="absolute -right-16 top-[46%] h-48 w-48 rounded-full bg-[radial-gradient(circle_at_35%_30%,rgb(var(--c-surface-raised)),rgb(var(--c-border)/0.4)_70%)] shadow-lift-2 dark:opacity-15" />
      </div>

      <div className="bv-panel mx-auto max-w-[1180px] p-space-md sm:p-space-lg lg:p-space-xl">
        <div className="grid grid-cols-1 gap-space-md min-[900px]:grid-cols-[1.05fr_1fr_0.9fr] min-[900px]:gap-[22px]">
          <div className="bv-card flex flex-col justify-end gap-space-md min-[900px]:min-h-[480px] lg:min-h-[520px]">
            <Eyebrow>Salas inteligentes</Eyebrow>
            <h1 className="font-display text-display-l-mobile text-ink [text-wrap:balance] lg:text-display-l">
              Saúde, beleza e bem-estar em um só lugar.
            </h1>
            <p className="font-lead text-lead text-ink-muted">
              Consultórios inteligentes e estúdios clínicos na Praia Brava, em Itajaí.
            </p>
            <div className="flex flex-wrap items-center gap-space-sm pt-space-xs">
              <a className={buttonClasses({ variant: 'gold' })} href="#salas">
                Conhecer as salas
              </a>
              <a className={buttonClasses({ variant: 'primary' })} href="#simulador">
                <span>Simular e reservar</span>
                <Icon as={ArrowRight} size={18} />
              </a>
            </div>
          </div>

          <div className="relative isolate aspect-[4/5] overflow-hidden rounded-lg bg-surface-deboss shadow-lift-2 md:aspect-[16/10] min-[900px]:aspect-auto">
            {/* Phones hide this photo behind the tour: the source resolves to the 12 kB video poster
                they fetch anyway, instead of the 126 kB desktop photo (GES-143). */}
            <picture>
              <source media="(max-width: 767px)" srcSet="/images/tour-poster.webp" />
              <img
                className="absolute inset-0 hidden h-full w-full object-cover md:block"
                src="/images/sala-principal.webp"
                alt="Sala Principal da Bravô Clinic: maca motorizada, mesa de mármore orgânica, poltronas em bouclé e cortinas de linho sob luz quente"
                fetchPriority="high"
              />
            </picture>
            {isWide ? null : (
              <video
                ref={videoRef}
                className="absolute inset-0 h-full w-full object-cover md:hidden"
                poster="/images/tour-poster.webp"
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                aria-label="Tour pela recepção e pelos consultórios da Bravô Clinic"
              >
                <source src="/images/tour-loop.webm" type="video/webm" />
                <source src="/images/tour-loop.mp4" type="video/mp4" />
              </video>
            )}
          </div>

          <ul aria-label="Destaques" className="flex flex-col gap-space-md min-[900px]:gap-[22px]">
            {HIGHLIGHTS.map(({ icon, label, tone }) => (
              <li
                key={label}
                className={cx(
                  'flex flex-1 flex-col justify-between gap-space-md',
                  highlightCard[tone],
                )}
              >
                <Icon as={icon} size={22} className={cx('relative z-10', highlightIcon[tone])} />
                <span className="bv-card-title relative z-10 m-0">{label}</span>
                {tone === 'emerald' ? <EmeraldSilk /> : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

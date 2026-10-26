import { ArrowRight, BadgeCheck, Clock, Receipt } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { focusRing } from '../../../components/ui/cx';
import { Icon } from '../../../components/ui/Icon';

const HIGHLIGHTS = [
  { icon: Clock, label: 'Por hora, meio turno ou turno' },
  { icon: Receipt, label: 'Sem taxa de adesão' },
  { icon: BadgeCheck, label: 'Sem condomínio ou burocracia fixa' },
];

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
 * Full-bleed photo hero: the flagship room on wide screens, a short vertical tour of the
 * clinic on phones. One primary action; booking details live in the simulator.
 */
/** The tour loop only exists below `md`, so wide screens never download it. */
function useIsWideScreen(): boolean {
  const [wide] = useState(
    () =>
      typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 768px)').matches,
  );
  return wide;
}

export function HeroSection() {
  const videoRef = useReducedMotionPause();
  const isWide = useIsWideScreen();

  return (
    <section className="relative isolate w-full overflow-hidden bg-surface-night min-h-[min(88vh,820px)] flex items-end">
      <img
        className="absolute inset-0 -z-20 hidden h-full w-full object-cover md:block"
        src="/images/sala-principal.webp"
        alt="Sala Principal da Bravô Clinic: maca motorizada, mesa de mármore orgânica, poltronas em bouclé e cortinas de linho sob luz quente"
        fetchPriority="high"
      />
      {isWide ? null : (
        <video
          ref={videoRef}
          className="absolute inset-0 -z-20 h-full w-full object-cover md:hidden"
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
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-surface-night/90 via-surface-night/45 to-surface-night/5 md:bg-gradient-to-r md:from-surface-night/85 md:via-surface-night/40 md:to-transparent" />

      <div className="max-w-7xl w-full mx-auto px-gutter pb-space-3xl pt-space-3xl">
        <div className="max-w-xl space-y-space-lg text-ink-night">
          <h1 className="font-display-xl-mobile text-display-xl-mobile md:font-display-xl md:text-display-xl tracking-tight [text-wrap:balance]">
            Saúde, beleza e bem-estar em um só lugar.
          </h1>
          <p className="font-lead text-lead text-ink-night/85">
            Consultórios inteligentes e estúdios clínicos na Praia Brava, em Itajaí.
          </p>
          <ul className="flex flex-wrap gap-space-sm" aria-label="Destaques">
            {HIGHLIGHTS.map(({ icon, label }) => (
              <li
                key={label}
                className="inline-flex items-center gap-space-xs rounded-full bg-surface-night/55 px-space-md py-space-xs font-caption text-caption text-ink-night ring-1 ring-ink-night/20"
              >
                <Icon as={icon} size={14} className="shrink-0 text-champagne" />
                <span>{label}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-space-lg pt-space-xs">
            <a
              className={`inline-flex items-center gap-space-xs bg-bronze hover:bg-walnut text-on-bronze font-small text-small uppercase tracking-[0.08em] px-space-xl py-space-md rounded shadow-md transition-colors duration-300 ${focusRing}`}
              href="#simulador"
            >
              <span>Simular e Reservar</span>
              <Icon as={ArrowRight} size={16} />
            </a>
            <a
              className={`font-small text-small text-ink-night underline underline-offset-4 decoration-ink-night/40 hover:decoration-ink-night ${focusRing}`}
              href="#salas"
            >
              Conhecer as Salas
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

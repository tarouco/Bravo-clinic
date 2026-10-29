import { ArrowRight, BadgeCheck, Clock, Receipt } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Eyebrow } from '../../../components/ui/Brand';
import { buttonClasses } from '../../../components/ui/Button';
import { Icon } from '../../../components/ui/Icon';
import { useMediaQueryOnce } from '../../../lib/useHydrated';

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

const HIGHLIGHTS = [
  { icon: Clock, label: 'Por hora, meio turno ou turno' },
  { icon: Receipt, label: 'Sem taxa de adesão' },
  { icon: BadgeCheck, label: 'Sem condomínio ou burocracia fixa' },
] as const;

/**
 * Full-bleed media hero, as before the rebrand, in v3 colors: the flagship room photo on wide
 * screens and the short vertical tour loop on phones run behind the floating NavBar, under a
 * Marrom Luxo scrim. The text sits on that scrim in pearl with a gold eyebrow, the key facts are
 * dark glass pills and the actions are the gold and emerald relief pills.
 */
export function HeroSection() {
  const videoRef = useReducedMotionPause();
  const isWide = useIsWideScreen();

  return (
    // -mt-20 pulls the media under the floating NavBar (PublicLayout pads main by 80px).
    <section className="relative isolate -mt-20 flex min-h-[min(92vh,860px)] w-full items-end overflow-hidden bg-[rgb(61_38_13)]">
      {/* Phones hide this photo behind the tour: the source resolves to the 12 kB video poster
          they fetch anyway, instead of the 126 kB desktop photo (GES-143). */}
      <picture>
        <source media="(max-width: 767px)" srcSet="/images/tour-poster.webp" />
        <img
          className="absolute inset-0 -z-20 hidden h-full w-full object-cover md:block"
          src="/images/sala-principal.webp"
          alt="Sala Principal da Bravô Clinic: maca motorizada, mesa de mármore orgânica, poltronas em bouclé e cortinas de linho sob luz quente"
          fetchPriority="high"
        />
      </picture>
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
      {/* Marrom Luxo scrim (Noite surface #3D260D): dense where the text sits, clear on the room. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-t from-[rgb(61_38_13/0.92)] via-[rgb(61_38_13/0.5)] to-[rgb(61_38_13/0.15)] md:bg-gradient-to-r md:from-[rgb(61_38_13/0.88)] md:via-[rgb(61_38_13/0.45)] md:to-transparent"
      />

      <div className="mx-auto w-full max-w-[1180px] px-5 pb-space-3xl pt-36 sm:px-gutter md:pb-[5.5rem]">
        <div className="max-w-2xl space-y-space-lg text-on-emerald">
          <Eyebrow className="text-gold">Salas inteligentes</Eyebrow>
          <h1 className="font-display text-display-xl-mobile font-light tracking-[0.02em] text-on-emerald [text-wrap:balance] md:text-display-l lg:text-[54px] lg:leading-[60px]">
            Saúde, beleza e <span className="whitespace-nowrap">bem-estar</span> em um só lugar.
          </h1>
          <p className="font-lead text-lead text-on-emerald/85">
            Consultórios inteligentes e estúdios clínicos na Praia Brava, em Itajaí.
          </p>
          <ul aria-label="Destaques" className="flex flex-wrap gap-space-sm">
            {HIGHLIGHTS.map(({ icon, label }) => (
              <li
                key={label}
                className="inline-flex items-center gap-space-xs rounded-pill bg-[rgb(61_38_13/0.55)] px-space-md py-2 font-caption text-caption text-on-emerald shadow-[inset_0_1px_0_rgb(255_235_151/0.18)] ring-1 ring-gold/30 backdrop-blur-hover"
              >
                <Icon as={icon} size={14} className="shrink-0 text-gold" />
                <span>{label}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-space-sm pt-space-xs">
            <a className={buttonClasses({ variant: 'primary' })} href="#simulador">
              <span>Simular e reservar</span>
              <Icon as={ArrowRight} size={18} />
            </a>
            <a className={buttonClasses({ variant: 'gold' })} href="#salas">
              Conhecer as salas
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

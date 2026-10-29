import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialog } from '../../../components/ui/useDialog';

export const INTRO_VIDEO_STORAGE_KEY = 'bravo:intro-video-seen';
export const INTRO_VIDEO_SRC = '/videos/reels-atendimento.mp4';
const INTRO_VIDEO_POSTER = '/videos/reels-poster.webp';

function alreadySeen(): boolean {
  try {
    return window.localStorage.getItem(INTRO_VIDEO_STORAGE_KEY) !== null;
  } catch {
    return true; // storage blocked: without memory the video would come back on every visit
  }
}

function markSeen(): void {
  try {
    window.localStorage.setItem(INTRO_VIDEO_STORAGE_KEY, new Date().toISOString());
  } catch {
    // Nothing to remember it in; `alreadySeen` already skips the video in that case.
  }
}

function IntroVideoPanel({ onClose }: { onClose: () => void }) {
  const { panelRef } = useDialog<HTMLDivElement>(onClose);

  return (
    // Any click, on the video or on the scrim, closes it; Escape closes it too (useDialog).
    <div
      className="bv-scrim fixed z-50 cursor-pointer"
      onClick={onClose}
      data-testid="intro-video-scrim"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Vídeo de apresentação da Bravô Clinic"
        tabIndex={-1}
        className="relative focus:outline-none"
      >
        {/* Browsers only autoplay muted video, so it starts muted. */}
        <video
          className="max-h-[85vh] w-auto max-w-[90vw] rounded-lg bg-emerald-deep shadow-lift-3"
          src={INTRO_VIDEO_SRC}
          poster={INTRO_VIDEO_POSTER}
          autoPlay
          muted
          playsInline
        >
          Seu navegador não reproduz este vídeo.
        </video>
        <p className="mt-space-sm text-center font-caption text-caption text-on-emerald">
          Toque em qualquer lugar para fechar
        </p>
      </div>
    </div>
  );
}

/** First-visit video on the Home: opens once per browser and closes on any click. */
export function IntroVideoModal() {
  // Opens after mount so the prerendered Home markup stays the same for every visitor.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (alreadySeen()) return;
    markSeen();
    setOpen(true);
  }, []);

  if (!open) return null;
  return createPortal(
    <IntroVideoPanel
      onClose={() => {
        setOpen(false);
      }}
    />,
    document.body,
  );
}

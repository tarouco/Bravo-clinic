import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialog } from '../../../components/ui/useDialog';
import { api } from '../../../lib/api';

export const INTRO_VIDEO_STORAGE_KEY = 'bravo:intro-video-seen';

export interface IntroVideo {
  /** Stored in `Logs_de_VSL.video_name`; give a new video a new name so the analysis can tell. */
  name: string;
  src: string;
  poster: string;
}

/** The videos the Home rotates through: visitor `turn` plays `INTRO_VIDEOS[turn % length]`. */
export const INTRO_VIDEOS: readonly IntroVideo[] = [
  {
    name: 'propaganda-instagram-01',
    src: '/videos/reels-atendimento.mp4',
    poster: '/videos/reels-poster.webp',
  },
  {
    name: 'promocional-atriz-bianca',
    src: '/videos/promocional-bianca.mp4',
    poster: '/videos/promocional-bianca-poster.webp',
  },
];

/** How long the Home waits for the API turn before picking a video at random. */
const TURN_TIMEOUT_MS = 2000;

type ExitMethod = 'click' | 'escape' | 'pagehide';

interface Playing {
  video: IntroVideo;
  /** Rotation turn from the API; null when it did not answer and the pick was random. */
  turn: number | null;
  openedAt: string;
}

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

async function takeTurn(): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, TURN_TIMEOUT_MS);
  try {
    const { turn } = await api.post<{ turn: number }>('/api/public/vsl/turn', undefined, {
      signal: controller.signal,
    });
    return Number.isInteger(turn) && turn >= 0 ? turn : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function deviceKind(): 'mobile' | 'desktop' {
  return window.matchMedia?.('(max-width: 767px), (pointer: coarse)').matches
    ? 'mobile'
    : 'desktop';
}

const seconds = (value: number | undefined) =>
  value !== undefined && Number.isFinite(value) && value >= 0
    ? Math.round(value * 1000) / 1000
    : null;

/**
 * Records where the visitor left the video. `keepalive` lets the request finish when the visitor
 * is leaving the page; a failure is dropped, since the log must never get in the way.
 */
function logExit(playing: Playing, video: HTMLVideoElement | null, exit: ExitMethod): void {
  const body = JSON.stringify({
    video: playing.video.name,
    turn: playing.turn,
    openedAt: playing.openedAt,
    playedSeconds: seconds(video?.currentTime) ?? 0,
    durationSeconds: seconds(video?.duration),
    exit,
    device: deviceKind(),
  });
  try {
    void fetch('/api/public/vsl/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => undefined);
  } catch {
    // fetch unavailable: nothing to log with.
  }
}

function IntroVideoPanel({
  playing,
  onClose,
}: {
  playing: Playing;
  onClose: (exit: ExitMethod, video: HTMLVideoElement | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { panelRef } = useDialog<HTMLDivElement>(() => {
    onClose('escape', videoRef.current);
  });

  return (
    // Any click, on the video or on the scrim, closes it; Escape closes it too (useDialog).
    <div
      className="bv-scrim fixed z-50 cursor-pointer"
      onClick={() => {
        onClose('click', videoRef.current);
      }}
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
          ref={videoRef}
          className="max-h-[80vh] w-auto max-w-[90vw] rounded-lg bg-emerald-deep shadow-lift-3 sm:max-h-[85vh]"
          src={playing.video.src}
          poster={playing.video.poster}
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

/**
 * First-visit video on the Home, on desktop and mobile: opens once per browser, alternating
 * between `INTRO_VIDEOS` across visitors, closes on any click, and logs where it was left.
 */
export function IntroVideoModal() {
  // Opens after mount so the prerendered Home markup stays the same for every visitor.
  const [playing, setPlaying] = useState<Playing | null>(null);
  const logged = useRef(false);

  useEffect(() => {
    if (alreadySeen()) return;
    // Marked before the turn arrives, so a reload meanwhile does not take a second turn. No
    // cleanup cancels the answer: StrictMode reruns this effect, and the rerun sees `alreadySeen`.
    markSeen();
    void takeTurn().then((turn) => {
      const index = (turn ?? Math.floor(Math.random() * INTRO_VIDEOS.length)) % INTRO_VIDEOS.length;
      setPlaying({
        video: INTRO_VIDEOS[index] ?? INTRO_VIDEOS[0]!,
        turn,
        openedAt: new Date().toISOString(),
      });
    });
  }, []);

  const close = (exit: ExitMethod, video: HTMLVideoElement | null) => {
    if (playing !== null && !logged.current) {
      logged.current = true;
      logExit(playing, video, exit);
    }
    setPlaying(null);
  };

  // Leaving the page (closing the tab, following a link) with the video still open is an exit too.
  useEffect(() => {
    if (playing === null) return;
    const onPageHide = () => {
      if (logged.current) return;
      logged.current = true;
      logExit(
        playing,
        document.querySelector('[data-testid="intro-video-scrim"] video'),
        'pagehide',
      );
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [playing]);

  if (playing === null) return null;
  return createPortal(<IntroVideoPanel playing={playing} onClose={close} />, document.body);
}

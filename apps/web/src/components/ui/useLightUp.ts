import { useCallback, useEffect, useRef, useState } from 'react';

/** How long a control stays lit after a click (bundle.js "click-to-light", DESIGN-v3.md Neon). */
export const LIGHT_UP_MS = 1600;

type TimerRef = { current: ReturnType<typeof setTimeout> | null };

function stop(timer: TimerRef): void {
  if (timer.current !== null) clearTimeout(timer.current);
  timer.current = null;
}

/**
 * Click-to-light for the v3 controls (AD-040): `lightUp()` adds `is-lit` for 1.6 s, a new click
 * restarts the time, and the timer is cleared on unmount. Starts unlit, so prerendered markup
 * (AD-036) is the same for every visitor. A disabled control never lights.
 */
export function useLightUp(disabled = false) {
  const [lit, setLit] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => stop(timer), []);

  useEffect(() => {
    if (!disabled) return;
    stop(timer);
    setLit(false);
  }, [disabled]);

  const lightUp = useCallback(() => {
    if (disabled) return;
    stop(timer);
    setLit(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setLit(false);
    }, LIGHT_UP_MS);
  }, [disabled]);

  return { lit, lightUp, litClass: lit ? 'is-lit' : undefined };
}

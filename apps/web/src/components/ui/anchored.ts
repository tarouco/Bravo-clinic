import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

export type AnchorAlign = 'start' | 'end';

/** Room under the anchor below which the panel opens upwards instead. */
const MIN_ROOM_BELOW_PX = 260;
/** Gap kept between a panel and the viewport edge. */
const VIEWPORT_MARGIN_PX = 8;

/**
 * Fixed-position placement of a panel under (or over) its anchor element. `position: fixed`
 * escapes `overflow` clipping of calendars and tables while the panel stays next to the anchor in
 * the DOM, so keyboard order is natural. The position follows scroll and resize while open.
 */
export function useAnchoredPanel(open: boolean, align: AnchorAlign) {
  const anchor = useRef<HTMLElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed' });

  const anchorRef = useCallback((node: HTMLElement | null) => {
    anchor.current = node;
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const roomBelow = window.innerHeight - rect.bottom;
      const below = roomBelow >= MIN_ROOM_BELOW_PX || rect.top < MIN_ROOM_BELOW_PX;
      setStyle({
        position: 'fixed',
        zIndex: 50,
        // A panel taller than the room left (a phone, an anchor low on the screen) scrolls inside
        // itself instead of putting its actions outside the viewport.
        maxHeight: Math.max(
          MIN_ROOM_BELOW_PX / 2,
          (below ? roomBelow : rect.top) - VIEWPORT_MARGIN_PX,
        ),
        overflowY: 'auto',
        ...(below ? { top: rect.bottom } : { bottom: window.innerHeight - rect.top }),
        ...(align === 'end' ? { right: window.innerWidth - rect.right } : { left: rect.left }),
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, align]);

  return { anchor, anchorRef, style };
}

/** Calls `onDismiss` on Escape while `open`; `onDismiss` may be an inline function. */
export function useEscape(open: boolean, onDismiss: () => void): void {
  const ref = useRef(onDismiss);
  ref.current = onDismiss;
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') ref.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);
}

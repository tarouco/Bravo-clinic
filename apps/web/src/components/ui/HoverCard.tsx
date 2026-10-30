import { useId, useState, type FocusEvent, type MouseEvent, type ReactNode } from 'react';
import { useAnchoredPanel, useEscape, type AnchorAlign } from './anchored';
import { cx } from './cx';
import { panelClasses } from './Popover';

/** Props the trigger element must receive: spread them on a focusable element. */
export interface HoverCardTriggerProps {
  ref: (node: HTMLElement | null) => void;
  onMouseEnter: () => void;
  onMouseLeave: (event: MouseEvent) => void;
  onFocus: () => void;
  onBlur: (event: FocusEvent) => void;
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
}

export interface HoverCardProps {
  trigger: (props: HoverCardTriggerProps) => ReactNode;
  /** Accessible name of the card. */
  label: string;
  /** Card content; it may hold actions, which stay reachable by pointer and by Tab. */
  children: ReactNode;
  align?: AnchorAlign;
  className?: string;
}

const insideOf = (node: Node | null, target: EventTarget | null): boolean =>
  node !== null && target instanceof Node && node.contains(target);

/**
 * Card shown while the pointer is over the trigger (or the card) or while the trigger has
 * keyboard focus; Escape closes it. The card sits flush against the trigger so the pointer can
 * cross into it, and it renders right after the trigger so Tab reaches its actions.
 */
export function HoverCard({
  trigger,
  label,
  children,
  align = 'start',
  className,
}: HoverCardProps) {
  const [open, setOpen] = useState(false);
  const cardId = useId();
  const { anchor, anchorRef, panel, panelRef, style } = useAnchoredPanel(open, align);

  useEscape(open, () => {
    setOpen(false);
  });

  const leaves = (event: { relatedTarget: EventTarget | null }) => {
    // Moving between the trigger and the card keeps it open.
    if (insideOf(panel.current, event.relatedTarget)) return;
    if (insideOf(anchor.current, event.relatedTarget)) return;
    setOpen(false);
  };

  return (
    <>
      {trigger({
        ref: anchorRef,
        onMouseEnter: () => {
          setOpen(true);
        },
        onMouseLeave: leaves,
        onFocus: () => {
          setOpen(true);
        },
        onBlur: leaves,
        'aria-expanded': open,
        'aria-controls': open ? cardId : undefined,
      })}
      {open ? (
        <div
          ref={panelRef}
          id={cardId}
          role="dialog"
          aria-label={label}
          style={style}
          className={cx(panelClasses, className)}
          onMouseLeave={leaves}
          onBlur={leaves}
        >
          {children}
        </div>
      ) : null}
    </>
  );
}

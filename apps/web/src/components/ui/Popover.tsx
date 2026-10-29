import { useEffect, useId, useState, type ReactNode } from 'react';
import { useAnchoredPanel, useEscape, type AnchorAlign } from './anchored';
import { cx } from './cx';

/** Props the trigger element must receive: spread them on a button or any focusable element. */
export interface PopoverTriggerProps {
  ref: (node: HTMLElement | null) => void;
  onClick: () => void;
  'aria-haspopup': 'dialog';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
}

export interface PopoverProps {
  /** Renders the trigger; spread the given props on it. */
  trigger: (props: PopoverTriggerProps) => ReactNode;
  /** Accessible name of the panel. */
  label: string;
  children: ReactNode;
  align?: AnchorAlign;
  className?: string;
}

/**
 * The v3 glass menu (`bv-menu`: glass, blurred backdrop, radius-md, lift-3 with rim). Never over
 * another glass layer: inside a glass panel, use a pearl `Card` instead.
 */
export const panelClasses = 'bv-menu w-72 max-w-[calc(100vw-1rem)] p-space-md text-ink';

/**
 * Click-to-open floating panel anchored to its trigger. Escape or a click outside closes it;
 * Escape returns focus to the trigger.
 */
export function Popover({ trigger, label, children, align = 'start', className }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { anchor, anchorRef, style } = useAnchoredPanel(open, align);

  useEscape(open, () => {
    setOpen(false);
    anchor.current?.focus();
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (anchor.current?.contains(target)) return;
      if (document.getElementById(panelId)?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, anchor, panelId]);

  return (
    <>
      {trigger({
        ref: anchorRef,
        onClick: () => {
          setOpen((current) => !current);
        },
        'aria-haspopup': 'dialog',
        'aria-expanded': open,
        'aria-controls': open ? panelId : undefined,
      })}
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={label}
          style={style}
          className={cx(panelClasses, className)}
        >
          {children}
        </div>
      ) : null}
    </>
  );
}

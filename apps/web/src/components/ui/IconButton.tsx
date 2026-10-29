import type { LucideIcon } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cx } from './cx';
import { Icon } from './Icon';
import { useLightUp } from './useLightUp';

export type IconButtonTone = 'pearl' | 'emerald' | 'gold' | 'brown';
export type IconButtonSize = 'md' | 'sm';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'aria-label'
> {
  /** The lucide glyph, drawn in outline at 1.7px. */
  icon: LucideIcon;
  /** Accessible name in Portuguese; an icon button is never nameless (guias/IconButton.md). */
  label: string;
  /** Pearl for utilities (search, back, theme); emerald only for the main add action. */
  tone?: IconButtonTone;
  /** 54px (`md`) or 42px (`sm`). */
  size?: IconButtonSize;
}

/** Class names of the round relief button, for links and dual-glyph buttons (ThemeToggle). */
export function iconButtonClasses({
  tone = 'pearl',
  size = 'md',
}: { tone?: IconButtonTone; size?: IconButtonSize } = {}): string {
  return cx('bv-icon-btn', `bv-btn--${tone}`, size === 'sm' && 'bv-icon-btn--sm');
}

/** Round high-relief button for a single icon, with the running neon and click-to-light. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, tone = 'pearl', size = 'md', className, disabled, onClick, type, ...rest },
  ref,
) {
  const { litClass, lightUp } = useLightUp(Boolean(disabled));
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-label={label}
      disabled={disabled}
      className={cx(iconButtonClasses({ tone, size }), litClass, className)}
      onClick={(event) => {
        lightUp();
        onClick?.(event);
      }}
      {...rest}
    >
      <Icon as={icon} size={size === 'sm' ? 18 : 20} />
    </button>
  );
});

import { forwardRef, useId, type ButtonHTMLAttributes } from 'react';
import { cx } from './cx';

export interface ToggleProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onChange' | 'children' | 'role' | 'aria-checked'
> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Text next to the switch (never inside the track); it also names the switch. */
  label: string;
  /** Keeps the label for assistive technology only. */
  hideLabel?: boolean;
  /** Optional line under the label, linked through `aria-describedby`. */
  description?: string;
  /** Classes for the wrapper that holds the switch and its label. */
  className?: string;
}

/**
 * On/off switch for settings that apply at once (guias/Toggle.md): a sunken track with a pearl
 * knob that fills emerald with the neon lit while on.
 */
export const Toggle = forwardRef<HTMLButtonElement, ToggleProps>(function Toggle(
  {
    checked,
    onCheckedChange,
    label,
    hideLabel = false,
    description,
    className,
    id,
    onClick,
    ...rest
  },
  ref,
) {
  const generatedId = useId();
  const switchId = id ?? generatedId;
  const descriptionId = `${switchId}-description`;

  return (
    <div className={cx('flex items-center gap-space-md', className)}>
      <button
        ref={ref}
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        {...(description ? { 'aria-describedby': descriptionId } : {})}
        className="bv-toggle shrink-0 disabled:cursor-not-allowed disabled:opacity-[0.42]"
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) onCheckedChange(!checked);
        }}
        {...rest}
      >
        <i aria-hidden="true" />
      </button>
      <span className={cx('flex flex-col', hideLabel && 'sr-only')}>
        <label htmlFor={switchId} className="cursor-pointer font-small text-small text-ink">
          {label}
        </label>
        {description ? (
          <span id={descriptionId} className="font-caption text-caption text-ink-muted">
            {description}
          </span>
        ) : null}
      </span>
    </div>
  );
});

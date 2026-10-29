import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cx } from './cx';

export interface SliderProps {
  /** Current value, between `min` and `max`. */
  value: number;
  onValueChange: (value: number) => void;
  /** Accessible name ("Horas por semana"). */
  label: string;
  min?: number;
  max?: number;
  step?: number;
  /** Text of the value, shown next to the track and read as `aria-valuetext`. */
  formatValue?: (value: number) => string;
  /** Renders the value next to the track instead of `formatValue`; return `null` to hide it. */
  children?: (value: number) => ReactNode;
  disabled?: boolean;
  /** Classes for the wrapper; the track keeps its 230px default unless `trackClassName` sets it. */
  className?: string;
  trackClassName?: string;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Draggable range control (guias/Slider.md): a sunken track, an emerald fill and a pearl knob.
 * Pointer drag and click-to-jump on the track; Arrow keys move one step, Page keys ten, Home and
 * End go to the ends. Controlled: every move calls `onValueChange` with a value on the step grid.
 */
export function Slider({
  value,
  onValueChange,
  label,
  min = 0,
  max = 100,
  step = 1,
  formatValue = String,
  children,
  disabled = false,
  className,
  trackClassName,
}: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const current = clamp(value, min, max);
  const percent = max > min ? ((current - min) / (max - min)) * 100 : 0;

  const snap = (raw: number): number => {
    const stepped = Math.round((raw - min) / step) * step + min;
    // Rounds away float noise (0.1 + 0.2) so the value stays on the step grid.
    return clamp(Number(stepped.toFixed(10)), min, max);
  };

  const commit = (next: number) => {
    const snapped = snap(next);
    if (snapped !== current) onValueChange(snapped);
  };

  const valueAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return current;
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    return min + ratio * (max - min);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    const track = event.currentTarget;
    track.focus();
    if (typeof track.setPointerCapture === 'function') track.setPointerCapture(event.pointerId);
    setDragging(true);
    commit(valueAt(event.clientX));
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    commit(valueAt(event.clientX));
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    const track = event.currentTarget;
    if (typeof track.releasePointerCapture === 'function') {
      track.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const big = step * 10;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = current + step;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = current - step;
        break;
      case 'PageUp':
        next = current + big;
        break;
      case 'PageDown':
        next = current - big;
        break;
      case 'Home':
        next = min;
        break;
      case 'End':
        next = max;
        break;
      default:
        return;
    }
    event.preventDefault();
    commit(next);
  };

  const shown = children ? children(current) : formatValue(current);

  return (
    <div className={cx('flex items-center gap-space-md', className)}>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={current}
        aria-valuetext={formatValue(current)}
        aria-disabled={disabled || undefined}
        className={cx(
          'bv-slider shrink-0',
          dragging && 'is-dragging',
          disabled && 'cursor-not-allowed opacity-[0.42]',
          trackClassName,
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        <span aria-hidden="true" className="bv-slider-fill" style={{ width: `${percent}%` }} />
        <span
          aria-hidden="true"
          className={cx('bv-slider-knob', dragging && 'is-lit')}
          style={{ left: `${percent}%` }}
        />
      </div>
      {shown === null ? null : (
        <span aria-hidden="true" className="min-w-[3ch] font-small text-small font-medium text-ink">
          {shown}
        </span>
      )}
    </div>
  );
}

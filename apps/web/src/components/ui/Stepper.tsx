import { Check } from 'lucide-react';
import { cx } from './cx';
import { Icon } from './Icon';

export interface StepperProps {
  /** Step labels in order; the booking flow uses exactly four (NUC-98). */
  steps: readonly string[];
  /** Zero-based index of the active step. */
  current: number;
  /** Accessible name of the step list. */
  label?: string;
  className?: string;
}

/** Numbered progress list: completed steps show a check, the active one has `aria-current="step"`. */
export function Stepper({ steps, current, label = 'Etapas', className }: StepperProps) {
  return (
    <nav aria-label={label} className={className}>
      <ol className="flex items-center gap-space-sm">
        {steps.map((step, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li
              key={step}
              aria-current={active ? 'step' : undefined}
              className={cx(
                'flex min-w-0 flex-1 items-center gap-space-sm font-small text-small',
                active ? 'text-ink' : 'text-ink-muted',
              )}
            >
              <span
                aria-hidden="true"
                className={cx(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-caption text-caption',
                  active || done
                    ? 'border-bronze bg-bronze text-on-bronze'
                    : 'border-border bg-surface-raised',
                )}
              >
                {done ? <Icon as={Check} size={14} /> : index + 1}
              </span>
              <span className={cx('truncate', active && 'font-medium')}>{step}</span>
              {done ? <span className="sr-only">(concluída)</span> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

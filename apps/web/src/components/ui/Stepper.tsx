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

/**
 * Numbered progress list of pills: the current step is the emerald pill (`aria-current="step"`),
 * completed ones sink with a check.
 */
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
                'flex min-w-0 flex-1 items-center gap-space-sm rounded-pill py-1 pl-1 pr-3 font-small text-small',
                active && 'bg-grad-emerald font-medium text-on-emerald shadow-relief-emerald',
                done && 'bg-surface-deboss text-ink shadow-deboss',
                !active && !done && 'text-ink-muted',
              )}
            >
              <span
                aria-hidden="true"
                className={cx(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-caption text-caption',
                  active && 'bg-surface-raised text-emerald',
                  done && 'bg-emerald text-on-emerald',
                  !active && !done && 'bg-surface-deboss shadow-deboss',
                )}
              >
                {done ? <Icon as={Check} size={14} /> : index + 1}
              </span>
              <span className="truncate">{step}</span>
              {done ? <span className="sr-only">(concluída)</span> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

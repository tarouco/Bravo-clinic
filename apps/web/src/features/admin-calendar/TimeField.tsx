import { useEffect, useState } from 'react';
import { cx } from '../../components/ui/cx';
import { Field } from '../../components/ui/form';
import { controlClasses } from '../../components/ui/form/controls';
import { formatHHMM, parseHHMM } from './time';

export interface TimeFieldProps {
  /** Accessible name; shown above the input unless `compact`. */
  label: string;
  /** Minute of the day (0..1440). */
  value: number;
  /** Called with a valid minute after the user leaves the field or presses Enter. */
  onCommit: (minute: number) => void;
  /** Returns a message when the parsed minute is not acceptable. */
  validate?: (minute: number) => string | null;
  /** External error (for example from the API) shown when the field has no error of its own. */
  error?: string | undefined;
  compact?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * "HH:MM" text input that keeps what the user types until it is committed: invalid text shows its
 * message and the committed value stays untouched.
 */
export function TimeField({
  label,
  value,
  onCommit,
  validate,
  error,
  compact = false,
  disabled = false,
  className,
}: TimeFieldProps) {
  const [draft, setDraft] = useState(formatHHMM(value));
  const [own, setOwn] = useState<string | null>(null);

  useEffect(() => {
    setDraft(formatHHMM(value));
    setOwn(null);
  }, [value]);

  const commit = () => {
    const minute = parseHHMM(draft);
    if (minute === null) {
      setOwn('Use o formato HH:MM, por exemplo 07:30.');
      return;
    }
    const problem = validate?.(minute) ?? null;
    if (problem) {
      setOwn(problem);
      return;
    }
    setOwn(null);
    if (minute !== value) onCommit(minute);
    else setDraft(formatHHMM(value));
  };

  return (
    <Field
      label={compact ? undefined : label}
      error={own ?? error}
      {...(className ? { className } : {})}
    >
      {(control) => (
        <input
          {...control}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="HH:MM"
          maxLength={5}
          disabled={disabled}
          {...(compact ? { 'aria-label': label } : {})}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            }
          }}
          className={cx(
            controlClasses(Boolean(own ?? error)),
            compact ? 'h-9 px-space-sm text-small' : 'h-12',
          )}
        />
      )}
    </Field>
  );
}

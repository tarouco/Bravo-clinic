import { ChevronDown } from 'lucide-react';
import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cx, focusRing } from '../cx';
import { Icon } from '../Icon';
import { Field, FieldError, HelpText, type FieldChromeProps } from './Field';

/**
 * Sunken v3 field (`bv-field`, AD-042): `surface-deboss` with `deboss`, 24px radius, neon border
 * and glow on focus, danger border when invalid. "Entry sinks, action rises" (DESIGN-v3.md).
 */
export const controlClasses = (invalid: boolean): string =>
  cx(
    'bv-field font-body text-body placeholder:text-ink-muted',
    // `aria-invalid` already paints the border; the class covers callers that do not set it.
    invalid && 'border-danger',
  );

export type InputProps = InputHTMLAttributes<HTMLInputElement> & FieldChromeProps;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, help, error, id, className, ...rest },
  ref,
) {
  return (
    <Field id={id} label={label} help={help} error={error}>
      {(control) => (
        <input
          ref={ref}
          {...rest}
          {...control}
          className={cx(controlClasses(Boolean(error)), 'h-12', className)}
        />
      )}
    </Field>
  );
});

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & FieldChromeProps;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, help, error, id, className, children, ...rest },
  ref,
) {
  return (
    <Field id={id} label={label} help={help} error={error}>
      {(control) => (
        <div className="relative">
          <select
            ref={ref}
            {...rest}
            {...control}
            className={cx(
              controlClasses(Boolean(error)),
              'h-12 cursor-pointer appearance-none pr-12',
              className,
            )}
          >
            {children}
          </select>
          <Icon
            as={ChevronDown}
            size={18}
            className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-ink-muted"
          />
        </div>
      )}
    </Field>
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & FieldChromeProps;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, help, error, id, className, rows = 4, ...rest },
  ref,
) {
  return (
    <Field id={id} label={label} help={help} error={error}>
      {(control) => (
        <textarea
          ref={ref}
          rows={rows}
          {...rest}
          {...control}
          className={cx(controlClasses(Boolean(error)), className)}
        />
      )}
    </Field>
  );
});

export interface CheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'children'
> {
  /** Text (or text with links) shown next to the box. */
  label: ReactNode;
  help?: string | undefined;
  error?: string | undefined;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, help, error, id, className, ...rest },
  ref,
) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const helpId = `${controlId}-help`;
  const errorId = `${controlId}-error`;
  const describedBy = [help ? helpId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className={className}>
      <div className="flex items-start gap-space-sm">
        <input
          ref={ref}
          {...rest}
          id={controlId}
          type="checkbox"
          {...(error ? { 'aria-invalid': true as const } : {})}
          {...(describedBy ? { 'aria-describedby': describedBy } : {})}
          className={cx(
            'mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded-[6px] border border-border accent-emerald',
            focusRing,
          )}
        />
        <label htmlFor={controlId} className="cursor-pointer font-small text-small text-ink">
          {label}
        </label>
      </div>
      {help ? <HelpText id={helpId}>{help}</HelpText> : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
});

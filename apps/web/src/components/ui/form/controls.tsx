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

/** DESIGN.md form base: raised surface, 1px border, 2px radius, bronze border on focus. */
export const controlClasses = (invalid: boolean): string =>
  cx(
    'w-full rounded-control border bg-surface-raised px-space-md font-body text-body text-ink placeholder:text-ink-muted',
    'transition-colors focus-visible:border-bronze disabled:cursor-not-allowed disabled:opacity-60',
    invalid ? 'border-error' : 'border-border',
    focusRing,
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
            className={cx(controlClasses(Boolean(error)), 'h-12 appearance-none pr-10', className)}
          >
            {children}
          </select>
          <Icon
            as={ChevronDown}
            size={18}
            className="pointer-events-none absolute right-space-md top-1/2 -translate-y-1/2 text-ink-muted"
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
          className={cx(controlClasses(Boolean(error)), 'py-space-sm', className)}
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
  help?: string;
  error?: string;
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
            'mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded-control border border-border accent-bronze',
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

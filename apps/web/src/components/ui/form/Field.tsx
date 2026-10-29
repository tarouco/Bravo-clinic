import { useId, type ReactNode } from 'react';
import { cx } from '../cx';

/** Props the form controls spread onto the native element to wire label, help and error text. */
export interface FieldControlProps {
  id: string;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}

/** Optional chrome every labelled control accepts. */
export interface FieldChromeProps {
  label?: string | undefined;
  help?: string | undefined;
  error?: string | undefined;
}

export function Label({
  htmlFor,
  children,
  className,
}: {
  htmlFor: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cx('mb-space-sm block font-small text-small font-medium text-ink', className)}
    >
      {children}
    </label>
  );
}

export function HelpText({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-space-xs font-caption text-caption text-ink-muted">
      {children}
    </p>
  );
}

export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-space-xs font-caption text-caption text-danger">
      {children}
    </p>
  );
}

interface FieldProps extends FieldChromeProps {
  /** Control id; generated when omitted. */
  id?: string | undefined;
  className?: string;
  /** Receives the props to spread onto the control. */
  children: (control: FieldControlProps) => ReactNode;
}

/** Visible label above the control, optional help and error text, all wired with aria attributes. */
export function Field({ id, label, help, error, className, children }: FieldProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const helpId = `${controlId}-help`;
  const errorId = `${controlId}-error`;
  const describedBy = [help ? helpId : null, error ? errorId : null].filter(Boolean).join(' ');

  const control: FieldControlProps = {
    id: controlId,
    ...(error ? { 'aria-invalid': true as const } : {}),
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
  };

  return (
    <div className={className}>
      {label ? <Label htmlFor={controlId}>{label}</Label> : null}
      {children(control)}
      {help ? <HelpText id={helpId}>{help}</HelpText> : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}

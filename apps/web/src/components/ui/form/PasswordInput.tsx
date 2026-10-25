import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useState } from 'react';
import { cx, focusRing } from '../cx';
import { Icon } from '../Icon';
import { controlClasses, type InputProps } from './controls';
import { Field } from './Field';

export type PasswordInputProps = Omit<InputProps, 'type'>;

/** Password field with a "Mostrar senha" / "Ocultar senha" visibility toggle. */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ label, help, error, id, className, ...rest }, ref) {
    const [visible, setVisible] = useState(false);

    return (
      <Field id={id} label={label} help={help} error={error}>
        {(control) => (
          <div className="relative">
            <input
              ref={ref}
              autoComplete="current-password"
              {...rest}
              {...control}
              type={visible ? 'text' : 'password'}
              className={cx(controlClasses(Boolean(error)), 'h-12 pr-12', className)}
            />
            <button
              type="button"
              aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
              onClick={() => setVisible((current) => !current)}
              className={cx(
                'absolute right-space-xs top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-control text-ink-muted hover:text-bronze',
                focusRing,
              )}
            >
              <Icon as={visible ? EyeOff : Eye} size={18} />
            </button>
          </div>
        )}
      </Field>
    );
  },
);

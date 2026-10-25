import { formatDocument } from '@bravo/core';
import { forwardRef, type ChangeEvent } from 'react';
import { Input, type InputProps } from './controls';

/** Progressive CPF/CNPJ mask: up to 11 digits as CPF, 12 to 14 as CNPJ. Non-digits are dropped. */
export function maskDocument(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 14);
  if (digits.length === 11) return formatDocument({ type: 'cpf', digits });
  if (digits.length === 14) return formatDocument({ type: 'cnpj', digits });
  if (digits.length <= 11) {
    return digits
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
  }
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3/$4')
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, '$1.$2.$3/$4-$5');
}

/** Progressive Brazilian phone mask: "(47) 9999-0000" (10 digits) or "(47) 99999-0000" (11). */
export function maskPhone(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 11);
  if (digits.length === 0) return '';
  const area = digits.slice(0, 2);
  const rest = digits.slice(2);
  if (digits.length <= 2) return `(${area}`;
  if (rest.length <= 4) return `(${area}) ${rest}`;
  const split = digits.length <= 10 ? 4 : 5;
  return `(${area}) ${rest.slice(0, split)}-${rest.slice(split)}`;
}

type MaskedInputProps = Omit<InputProps, 'type'>;

function withMask(
  mask: (value: string) => string,
  defaults: { inputMode: 'numeric' | 'tel'; autoComplete: string; placeholder: string },
) {
  return forwardRef<HTMLInputElement, MaskedInputProps>(function MaskedInput(
    { onChange, value, defaultValue, ...rest },
    ref,
  ) {
    // Rewrites the DOM value before the event reaches the consumer, so uncontrolled use and
    // react-hook-form `register` both read the masked string.
    const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
      event.target.value = mask(event.target.value);
      onChange?.(event);
    };

    return (
      <Input
        ref={ref}
        type="text"
        {...defaults}
        {...rest}
        {...(value !== undefined ? { value: mask(String(value)) } : {})}
        {...(defaultValue !== undefined ? { defaultValue: mask(String(defaultValue)) } : {})}
        onChange={handleChange}
      />
    );
  });
}

/** CPF/CNPJ input that masks while typing. */
export const DocumentInput = withMask(maskDocument, {
  inputMode: 'numeric',
  autoComplete: 'off',
  placeholder: '000.000.000-00',
});

/** Brazilian phone input that masks while typing. */
export const PhoneInput = withMask(maskPhone, {
  inputMode: 'tel',
  autoComplete: 'tel-national',
  placeholder: '(00) 00000-0000',
});

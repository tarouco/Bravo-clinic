import { forwardRef, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { cx } from './cx';

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> {
  /** Selected chips turn emerald with the neon lit (`aria-pressed="true"`). */
  selected?: boolean;
}

/** Pearl pill for one choice in a set (time slots, filters), guias/Chip.md. */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { selected = false, className, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-pressed={selected}
      className={cx('bv-chip', className)}
      {...rest}
    />
  );
});

export interface ChipOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

interface ChipGroupBase<T extends string> {
  options: readonly ChipOption<T>[];
  /** Accessible name of the group ("Horários", "Categoria"). */
  label: string;
  className?: string;
}

interface SingleChipGroupProps<T extends string> extends ChipGroupBase<T> {
  multiple?: false;
  /** The selected value; `null` while nothing is chosen. */
  value: T | null;
  onChange: (value: T) => void;
}

interface MultipleChipGroupProps<T extends string> extends ChipGroupBase<T> {
  multiple: true;
  value: readonly T[];
  onChange: (value: T[]) => void;
}

export type ChipGroupProps<T extends string> = SingleChipGroupProps<T> | MultipleChipGroupProps<T>;

/**
 * A row of chips. Single choice by default: a click selects that chip and the others go out;
 * `multiple` toggles each chip on its own. Controlled through `value` and `onChange`.
 */
export function ChipGroup<T extends string>(props: SingleChipGroupProps<T>): ReactElement;
export function ChipGroup<T extends string>(props: MultipleChipGroupProps<T>): ReactElement;
export function ChipGroup<T extends string>(props: ChipGroupProps<T>): ReactElement {
  const { options, label, className } = props;

  const isSelected = (value: T): boolean =>
    props.multiple ? props.value.includes(value) : props.value === value;

  const choose = (value: T) => {
    if (props.multiple) {
      props.onChange(
        props.value.includes(value)
          ? props.value.filter((current) => current !== value)
          : [...props.value, value],
      );
    } else if (props.value !== value) {
      props.onChange(value);
    }
  };

  return (
    <div role="group" aria-label={label} className={cx('bv-chips flex-wrap', className)}>
      {options.map((option) => (
        <Chip
          key={option.value}
          selected={isSelected(option.value)}
          disabled={option.disabled}
          onClick={() => {
            choose(option.value);
          }}
        >
          {option.label}
        </Chip>
      ))}
    </div>
  );
}

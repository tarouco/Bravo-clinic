import type { LucideIcon } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cx, focusRing } from './cx';
import { Icon } from './Icon';
import { useLightUp } from './useLightUp';

export type ButtonVariant = 'primary' | 'secondary' | 'gold' | 'brown' | 'ghost' | 'link';
export type ButtonSize = 'md' | 'sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary` is the emerald action (one per view), `secondary` the pearl neutral one. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Full width, 54px tall (`bv-btn--block`). */
  block?: boolean;
  /** Disables the button, sets `aria-busy` and shows a spinner. */
  loading?: boolean;
  leadingIcon?: LucideIcon;
  trailingIcon?: LucideIcon;
  /** Render the single child element (e.g. a router `Link` or `a`) with the button styles. */
  asChild?: boolean;
}

// The relief pills are the kit's `bv-btn` (styles/bv.css): neon on hover/focus, lit for 1.6 s after
// a click, sunk while pressed, 42% and flat when disabled, accent outline on keyboard focus.
const pills: Record<Exclude<ButtonVariant, 'link'>, string> = {
  primary: 'bv-btn bv-btn--emerald',
  secondary: 'bv-btn bv-btn--pearl',
  gold: 'bv-btn bv-btn--gold',
  brown: 'bv-btn bv-btn--brown',
  // A pill without relief: text in ink, a translucent shade on hover.
  ghost: 'bv-btn bg-transparent text-ink shadow-none hover:bg-glass-hover',
};

const linkClasses = cx(
  'inline-flex h-auto items-center gap-space-xs bg-transparent px-0 font-label text-label text-accent underline underline-offset-4 hover:text-accent-deep disabled:cursor-not-allowed disabled:opacity-[0.42]',
  focusRing,
);

/** Class names of a button look, for elements that cannot be a `Button` (a `label`, a `NavLink`). */
export function buttonClasses({
  variant = 'primary',
  size = 'md',
  block = false,
}: { variant?: ButtonVariant; size?: ButtonSize; block?: boolean } = {}): string {
  if (variant === 'link') return linkClasses;
  return cx(
    pills[variant],
    size === 'sm' && 'bv-btn--sm',
    block && 'bv-btn--block',
    // `asChild` links cannot be `:disabled`; they carry `aria-disabled` while loading.
    'aria-disabled:pointer-events-none aria-disabled:opacity-[0.42] aria-disabled:shadow-none',
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    block = false,
    loading = false,
    leadingIcon,
    trailingIcon,
    asChild = false,
    className,
    children,
    disabled,
    onClick,
    type,
    ...rest
  },
  ref,
) {
  const { litClass, lightUp } = useLightUp(Boolean(disabled) || loading);
  const classes = cx(buttonClasses({ variant, size, block }), litClass, className);
  const iconSize = size === 'sm' ? 16 : 18;

  const renderContent = (content: ReactNode) => (
    <>
      {loading ? (
        <Loader2 aria-hidden="true" strokeWidth={1.7} size={iconSize} className="animate-spin" />
      ) : leadingIcon ? (
        <Icon as={leadingIcon} size={iconSize} />
      ) : null}
      {content}
      {trailingIcon && !loading ? <Icon as={trailingIcon} size={iconSize} /> : null}
    </>
  );

  if (asChild) {
    const child = Children.only(children);
    if (!isValidElement(child)) {
      throw new Error('Button asChild expects a single React element child');
    }
    const element = child as ReactElement<{
      className?: string;
      children?: ReactNode;
      onClick?: (event: MouseEvent<HTMLElement>) => void;
    }>;
    const childOnClick = element.props.onClick;
    return cloneElement(
      element,
      {
        ...(rest as object),
        className: cx(classes, element.props.className),
        ...(loading ? { 'aria-busy': true, 'aria-disabled': true } : {}),
        onClick: (event: MouseEvent<HTMLElement>) => {
          if (loading) {
            event.preventDefault();
            return;
          }
          lightUp();
          childOnClick?.(event);
          onClick?.(event as unknown as MouseEvent<HTMLButtonElement>);
        },
      },
      renderContent(element.props.children),
    );
  }

  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onClick={(event) => {
        lightUp();
        onClick?.(event);
      }}
      {...rest}
    >
      {renderContent(children)}
    </button>
  );
});

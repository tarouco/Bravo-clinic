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

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'link';
export type ButtonSize = 'md' | 'sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Disables the button, sets `aria-busy` and shows a spinner. */
  loading?: boolean;
  leadingIcon?: LucideIcon;
  trailingIcon?: LucideIcon;
  /** Render the single child element (e.g. a router `Link` or `a`) with the button styles. */
  asChild?: boolean;
}

const base =
  'inline-flex items-center justify-center gap-space-xs font-small text-small uppercase tracking-[0.08em] rounded-control transition-colors disabled:cursor-not-allowed disabled:opacity-60';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-bronze text-on-bronze hover:bg-walnut',
  secondary: 'bg-surface-raised border border-border text-ink hover:bg-surface-stone',
  ghost:
    'bg-transparent text-bronze border-b border-transparent hover:border-hairline hover:text-ink',
  link: 'bg-transparent text-bronze underline underline-offset-4 hover:text-walnut',
};

const sizes: Record<ButtonVariant, Record<ButtonSize, string>> = {
  primary: { md: 'h-12 px-space-lg', sm: 'h-10 px-space-md' },
  secondary: { md: 'h-12 px-space-lg', sm: 'h-10 px-space-md' },
  ghost: { md: 'h-12 px-space-md', sm: 'h-10 px-space-sm' },
  link: { md: 'h-auto px-0', sm: 'h-auto px-0' },
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
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
  const classes = cx(base, variants[variant], sizes[variant][size], focusRing, className);
  const iconSize = size === 'sm' ? 16 : 18;

  const renderContent = (content: ReactNode) => (
    <>
      {loading ? (
        <Loader2 aria-hidden="true" strokeWidth={1.5} size={iconSize} className="animate-spin" />
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
      onClick={onClick}
      {...rest}
    >
      {renderContent(children)}
    </button>
  );
});

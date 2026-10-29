import { CircleAlert, CircleCheck, Info, Loader2, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './Icon';

export type AlertTone = 'info' | 'error' | 'success';

const tones: Record<AlertTone, { classes: string; icon: LucideIcon }> = {
  info: { classes: 'border-hairline bg-champagne-soft text-on-champagne', icon: Info },
  error: { classes: 'border-error bg-error-container text-on-error-container', icon: CircleAlert },
  success: { classes: 'border-hairline bg-surface-stone text-ink', icon: CircleCheck },
};

/** Inline feedback. Errors use `role="alert"`; info and success use `role="status"`. */
export function Alert({
  tone = 'info',
  children,
  className,
}: {
  tone?: AlertTone;
  children: ReactNode;
  className?: string;
}) {
  const { classes, icon } = tones[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'flex items-start gap-space-sm rounded-control border px-space-md py-space-sm font-small text-small',
        classes,
        className,
      )}
    >
      <Icon as={icon} size={18} className="mt-0.5 shrink-0" />
      <div className="flex-1">{children}</div>
    </div>
  );
}

export function Spinner({
  label = 'Carregando',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span role="status" aria-label={label} className={cx('inline-flex text-bronze', className)}>
      <Loader2 aria-hidden="true" strokeWidth={1.7} size={24} className="animate-spin" />
    </span>
  );
}

/** Placeholder for sections that ship in a later feature. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <section className="mx-auto flex max-w-2xl flex-col items-center gap-space-sm py-space-3xl text-center">
      <h1 className="font-heading text-heading-mobile text-ink md:text-heading">{title}</h1>
      <p className="font-body text-body text-ink-muted">Em construção</p>
    </section>
  );
}

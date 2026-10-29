import {
  CircleAlert,
  CircleCheck,
  Info,
  Loader2,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './Icon';

export type AlertTone = 'info' | 'error' | 'success' | 'neutral' | 'warning';

// Derived status colors (AD-042): error on danger-soft, success on emerald, warning on gold.
const tones: Record<AlertTone, { classes: string; icon: LucideIcon; iconClass: string }> = {
  info: {
    classes: 'bg-surface-raised text-ink shadow-[var(--lift-1),var(--rim)]',
    icon: Info,
    iconClass: 'text-accent',
  },
  error: { classes: 'bg-danger-soft text-danger', icon: CircleAlert, iconClass: 'text-danger' },
  success: { classes: 'bg-emerald text-on-emerald', icon: CircleCheck, iconClass: '' },
  neutral: { classes: 'bg-surface-panel text-ink', icon: Info, iconClass: 'text-ink-muted' },
  warning: { classes: 'bg-gold text-on-gold', icon: TriangleAlert, iconClass: '' },
};

/** Inline feedback. Errors use `role="alert"`; the other tones use `role="status"`. */
export function Alert({
  tone = 'info',
  children,
  className,
}: {
  tone?: AlertTone;
  children: ReactNode;
  className?: string;
}) {
  const { classes, icon, iconClass } = tones[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'flex items-start gap-space-sm rounded-md px-5 py-space-md font-small text-small',
        classes,
        className,
      )}
    >
      <Icon as={icon} size={18} className={cx('mt-0.5 shrink-0', iconClass)} />
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
    <span role="status" aria-label={label} className={cx('inline-flex text-accent', className)}>
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

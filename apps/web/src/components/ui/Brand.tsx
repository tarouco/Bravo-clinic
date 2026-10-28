import type { ReactNode } from 'react';

const joinClasses = (...parts: (string | undefined)[]): string => parts.filter(Boolean).join(' ');

/** Two-line "BRAVÔ CLINIC / SALAS INTELIGENTES" signature used by the header and the footer. */
export function BrandLockup({
  variant = 'header',
  className,
}: {
  variant?: 'header' | 'footer';
  className?: string;
}) {
  return (
    <span
      className={joinClasses(
        'flex flex-col',
        variant === 'header' ? 'text-left' : 'items-start',
        className,
      )}
    >
      <span className="font-eyebrow text-eyebrow font-semibold uppercase tracking-[0.32em] text-ink">
        BRAVÔ CLINIC
      </span>{' '}
      <span className="font-caption text-caption uppercase tracking-[0.2em] text-ink-muted">
        SALAS INTELIGENTES
      </span>
    </span>
  );
}

/** Small uppercase section label in bronze. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={joinClasses(
        'block font-eyebrow text-caption uppercase tracking-[0.28em] text-bronze',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Signature device: eyebrow text flanked by thin hairline rules (default "SALAS INTELIGENTES"). */
export function EyebrowLockup({
  children = 'SALAS INTELIGENTES',
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={joinClasses('flex items-center justify-center gap-space-md', className)}>
      <span aria-hidden="true" className="block h-px w-10 bg-hairline" />
      <span className="font-eyebrow text-eyebrow uppercase tracking-[0.32em] text-ink-muted">
        {children}
      </span>
      <span aria-hidden="true" className="block h-px w-10 bg-hairline" />
    </div>
  );
}

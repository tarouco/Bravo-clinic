import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BrandLockup, Eyebrow } from '../../components/ui/Brand';

/** Accent text link of the auth pages ("Esqueci minha senha", "Criar conta"). */
export const authLinkClasses = 'text-accent underline underline-offset-4 hover:text-accent-deep';

/**
 * Shared frame of every auth page: on the névoa stage, the name in type above a pearl card
 * (radius-xl) holding the eyebrow, the title and the form.
 */
export function AuthCard({
  title,
  eyebrow = 'Área do cliente',
  children,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
}) {
  return (
    <section className="mx-auto flex w-full max-w-md flex-col items-center px-gutter py-space-2xl md:py-space-3xl">
      <Link
        to="/"
        aria-label="Bravô Clinic, página inicial"
        className="mb-space-lg rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
      >
        <BrandLockup tagline className="items-center" />
      </Link>
      <div className="bv-card w-full rounded-xl sm:p-space-xl">
        <header className="mb-space-lg space-y-space-xs text-center">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="font-display text-display-l-mobile text-ink">{title}</h1>
        </header>
        <div className="space-y-space-md">{children}</div>
      </div>
    </section>
  );
}

import type { ReactNode } from 'react';
import { Eyebrow } from '../../components/ui/Brand';
import { Card } from '../../components/ui/Card';

/** Centered card with eyebrow and page title shared by every auth page. */
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
    <section className="mx-auto w-full max-w-md px-gutter py-space-3xl">
      <header className="mb-space-lg space-y-space-xs text-center">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="font-heading text-heading-mobile text-ink md:text-heading">{title}</h1>
      </header>
      <Card variant="raised">
        <div className="space-y-space-md">{children}</div>
      </Card>
    </section>
  );
}

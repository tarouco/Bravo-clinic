import { Markdown } from '../../lib/markdown';
import { usePageTitle } from '../../lib/usePageTitle';
import privacidade from '../../content/legal/privacidade.md?raw';
import termos from '../../content/legal/termos.md?raw';

/** Versions recorded as consents at signup (fundação) and shown on the legal pages. */
export const LEGAL_VERSIONS = { termos: 'terms-2026-10', privacidade: 'privacy-2026-10' } as const;

const PAGES = {
  termos: { source: termos, title: 'Termos de uso' },
  privacidade: { source: privacidade, title: 'Política de privacidade' },
} as const;

/** `/termos` and `/privacidade`: the Markdown text with its version line (NUC-186). */
export function LegalPage({ kind }: { kind: keyof typeof PAGES }) {
  const { source, title } = PAGES[kind];
  usePageTitle(title);
  return (
    <article className="mx-auto max-w-3xl px-gutter py-space-3xl">
      <div className="bv-card space-y-space-lg sm:p-space-xl">
        <Markdown source={source} />
        <p className="font-caption text-caption text-ink-muted">Versão {LEGAL_VERSIONS[kind]}</p>
      </div>
    </article>
  );
}

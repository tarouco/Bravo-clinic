import { Link } from 'react-router-dom';
import { Eyebrow } from '../ui/Brand';
import { Button } from '../ui/Button';

/** Shown to a signed-in user who opens an area their role cannot access. */
export function ForbiddenPage() {
  return (
    <section className="mx-auto max-w-xl px-5 py-space-hero">
      <div className="bv-card space-y-space-md p-space-xl text-center">
        <Eyebrow>Erro 403</Eyebrow>
        <h1 className="font-display-l-mobile text-display-l-mobile text-ink md:font-display-l md:text-display-l">
          Acesso restrito
        </h1>
        <p className="font-body text-body text-ink-muted">
          Você não tem permissão para acessar esta área.
        </p>
        <Button asChild>
          <Link to="/app">Ir para minha área</Link>
        </Button>
      </div>
    </section>
  );
}

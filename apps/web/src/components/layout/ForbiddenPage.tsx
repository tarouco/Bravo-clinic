import { Link } from 'react-router-dom';
import { Eyebrow } from '../ui/Brand';
import { Button } from '../ui/Button';

/** Shown to a signed-in user who opens an area their role cannot access. */
export function ForbiddenPage() {
  return (
    <section className="max-w-7xl mx-auto px-gutter py-space-hero text-center space-y-space-md">
      <Eyebrow>Erro 403</Eyebrow>
      <h1 className="font-display-l-mobile text-display-l-mobile md:font-display-l md:text-display-l uppercase text-ink">
        Acesso restrito
      </h1>
      <p className="font-body text-body text-ink-muted">
        Você não tem permissão para acessar esta área.
      </p>
      <Button asChild>
        <Link to="/app">Ir para minha área</Link>
      </Button>
    </section>
  );
}

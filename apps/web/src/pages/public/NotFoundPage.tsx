import { Link } from 'react-router-dom';
import { Eyebrow } from '../../components/ui/Brand';
import { Button } from '../../components/ui/Button';

export function NotFoundPage() {
  return (
    <section className="mx-auto max-w-7xl px-gutter py-space-hero">
      <div className="bv-card mx-auto max-w-xl space-y-space-md rounded-xl text-center sm:p-space-xl">
        <Eyebrow>Erro 404</Eyebrow>
        <h1 className="font-display text-display-l-mobile text-ink md:text-display-l">
          Página não encontrada
        </h1>
        <p className="font-body text-body text-ink-muted">
          O endereço que você tentou abrir não existe ou foi movido.
        </p>
        <Button asChild>
          <Link to="/">Voltar ao início</Link>
        </Button>
      </div>
    </section>
  );
}

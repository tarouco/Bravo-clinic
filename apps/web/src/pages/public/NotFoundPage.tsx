import { Link } from 'react-router-dom';
import { Eyebrow } from '../../components/ui/Brand';
import { Button } from '../../components/ui/Button';

export function NotFoundPage() {
  return (
    <section className="max-w-7xl mx-auto px-gutter py-space-hero text-center space-y-space-md">
      <Eyebrow>Erro 404</Eyebrow>
      <h1 className="font-display-l-mobile text-display-l-mobile md:font-display-l md:text-display-l uppercase text-ink">
        Página não encontrada
      </h1>
      <p className="font-body text-body text-ink-muted">
        O endereço que você tentou abrir não existe ou foi movido.
      </p>
      <Button asChild>
        <Link to="/">Voltar ao início</Link>
      </Button>
    </section>
  );
}

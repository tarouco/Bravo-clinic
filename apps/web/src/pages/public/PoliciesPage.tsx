import { Eyebrow } from '../../components/ui/Brand';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { usePolicies } from '../../features/catalog/api';
import { usePageTitle } from '../../lib/usePageTitle';

/** `/politicas`: the policy text rendered by core from the current settings (NUC-184). */
export function PoliciesPage() {
  usePageTitle('Políticas');
  const { data, isPending, isError } = usePolicies();

  return (
    <section className="mx-auto max-w-3xl space-y-space-xl px-gutter py-space-3xl">
      <div className="space-y-space-xs">
        <Eyebrow>REGRAS DE RESERVA</Eyebrow>
        <h1 className="font-display-l-mobile text-display-l-mobile text-ink md:font-display-l md:text-display-l">
          Políticas
        </h1>
      </div>

      {isPending ? (
        <Spinner label="Carregando políticas" />
      ) : isError ? (
        <Alert tone="error">Não foi possível carregar as políticas agora.</Alert>
      ) : (
        <>
          {data.sections.map((section) => (
            <section key={section.title} className="space-y-space-xs">
              <h2 className="font-heading-mobile text-heading-mobile text-ink">{section.title}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph} className="font-body text-body text-ink-muted">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
          <p className="font-caption text-caption text-ink-muted">
            Versão da política: {data.version}
          </p>
        </>
      )}
    </section>
  );
}

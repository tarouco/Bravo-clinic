import { formatBRL, chargeStatusLabel } from '@bravo/core';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { CopyField } from '../../components/ui/CopyField';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { useSandboxAction, useSandboxCharge } from '../../features/payments/api';
import { ApiError } from '../../lib/api';
import { usePageTitle } from '../../lib/usePageTitle';
import { NotFoundPage } from './NotFoundPage';

/** `/pagamento/sandbox/:chargeId`: the demo gateway's hosted page (AD-006, NUC-120). */
export function SandboxCheckoutPage() {
  usePageTitle('Pagamento de teste');
  const { chargeId } = useParams();
  const query = useSandboxCharge(chargeId);
  const action = useSandboxAction(chargeId ?? '');
  const charge = query.data;

  if (query.isPending) {
    return (
      <div className="flex justify-center py-space-hero">
        <Spinner label="Carregando cobrança" />
      </div>
    );
  }
  if (query.error instanceof ApiError && query.error.status === 404) return <NotFoundPage />;
  if (!charge) {
    return (
      <div className="mx-auto max-w-2xl px-gutter py-space-3xl">
        <Alert tone="error">Não foi possível carregar a cobrança agora.</Alert>
      </div>
    );
  }

  const pending = charge.status === 'pending';
  const backTo = charge.bookingId ? `/checkout/${charge.bookingId}` : '/app/minhas-reservas';
  const outcome = action.data?.status;

  return (
    <div className="mx-auto max-w-xl px-gutter py-space-xl md:py-space-3xl">
      <div className="bv-card space-y-space-lg rounded-xl sm:p-space-xl">
        <Alert tone="neutral">
          Ambiente de demonstração: nenhum pagamento real será feito. Escolha o resultado abaixo.
        </Alert>
        <header className="space-y-space-xs">
          <h1 className="font-display text-display-l-mobile text-ink md:text-display-l">
            Pagamento de teste
          </h1>
          <p className="font-body text-body text-ink-muted">
            {charge.bookingCode ? `Reserva ${charge.bookingCode} · ` : ''}
            {formatBRL(charge.amountCents)} · {charge.method === 'pix' ? 'Pix' : 'Cartão'}
          </p>
          <p className="font-small text-small text-ink-muted">
            Situação: {chargeStatusLabel[charge.status]}
          </p>
        </header>

        {charge.pixCopyPaste && pending ? (
          <CopyField
            label="Pix copia e cola (demonstração)"
            value={charge.pixCopyPaste}
            buttonLabel="Copiar código Pix"
          />
        ) : null}

        {action.isError ? (
          <Alert tone="error">
            {action.error instanceof ApiError
              ? action.error.message
              : 'Não foi possível concluir a ação. Tente novamente.'}
          </Alert>
        ) : null}
        {outcome === 'approved' ? <Alert tone="success">Pagamento aprovado.</Alert> : null}
        {outcome === 'rejected' ? <Alert tone="error">Pagamento recusado.</Alert> : null}

        {pending && !outcome ? (
          <div className="flex flex-wrap gap-space-sm">
            <Button
              loading={action.isPending && action.variables === 'approve'}
              disabled={action.isPending}
              onClick={() => {
                action.mutate('approve');
              }}
            >
              Aprovar pagamento
            </Button>
            <Button
              variant="secondary"
              loading={action.isPending && action.variables === 'reject'}
              disabled={action.isPending}
              onClick={() => {
                action.mutate('reject');
              }}
            >
              Recusar pagamento
            </Button>
          </div>
        ) : null}

        <Button asChild variant={pending && !outcome ? 'ghost' : 'primary'}>
          <Link to={backTo}>Voltar para a reserva</Link>
        </Button>
      </div>
    </div>
  );
}

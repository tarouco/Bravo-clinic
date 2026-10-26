import { Check } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/Icon';
import { useToast } from '../../components/ui/Toast';
import { messageOf } from '../../lib/api-errors';
import { useConfirmPricesReviewed } from '../categories/api';

const ITEMS = [
  'Revise os valores das categorias',
  'Confirme a categoria de referência (V_ref)',
  'Revise as políticas de pagamento e cancelamento',
] as const;

/**
 * First-access checklist (NUC-73): shown while `onboarding.pricesReviewed` is false; the button
 * opens online booking to tenants (NUC-70).
 */
export function OnboardingChecklist() {
  const confirm = useConfirmPricesReviewed();
  const { toast } = useToast();

  return (
    <section
      aria-labelledby="onboarding-title"
      className="space-y-space-md rounded-card border border-champagne bg-champagne-soft p-space-lg text-on-champagne"
    >
      <h2 id="onboarding-title" className="font-heading text-heading-mobile">
        Antes de abrir as reservas online
      </h2>
      <p className="font-small text-small">
        Os valores atuais são exemplos. Reservas online abrem para os clientes depois da revisão.
      </p>
      <ul className="space-y-space-xs font-small text-small">
        {ITEMS.map((item) => (
          <li key={item} className="flex items-center gap-space-sm">
            <Icon as={Check} size={16} />
            {item}
          </li>
        ))}
      </ul>
      {confirm.isError ? (
        <Alert tone="error">
          {messageOf(confirm.error, 'Não foi possível salvar. Tente novamente.')}
        </Alert>
      ) : null}
      <Button
        loading={confirm.isPending}
        onClick={() => {
          confirm.mutate(undefined, {
            onSuccess: () => {
              toast({ message: 'Preços marcados como revisados. Reservas online liberadas.' });
            },
          });
        }}
      >
        Marcar preços como revisados
      </Button>
    </section>
  );
}

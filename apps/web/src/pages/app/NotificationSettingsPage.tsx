import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { usePushSubscription, type PushStatus } from '../../features/push/usePushSubscription';
import { usePageTitle } from '../../lib/usePageTitle';

/** The explanation shown instead of the button, per state (GES-83). */
export const PUSH_EXPLANATIONS: Partial<Record<PushStatus, string>> = {
  'ios-not-installed':
    'No iPhone e no iPad, as notificações só funcionam com o app instalado. Toque em Compartilhar, escolha "Adicionar à Tela de Início", abra o app pelo ícone e volte a esta página.',
  unsupported:
    'Este navegador não oferece notificações push. Use uma versão atualizada do Chrome, Edge, Firefox ou Safari.',
  denied:
    'As notificações estão bloqueadas neste navegador. Libere-as nas configurações do site e recarregue a página.',
  unavailable:
    'As notificações push não estão disponíveis no momento. Você continua recebendo os avisos por e-mail.',
};

/** `/app/perfil/notificacoes`: turn web push on or off for this device (GES-83). */
export function NotificationSettingsPage() {
  usePageTitle('Notificações');
  const { status, busy, error, enable, disable } = usePushSubscription();
  const explanation = PUSH_EXPLANATIONS[status];

  return (
    <div className="mx-auto max-w-xl space-y-space-lg">
      <h1 className="font-heading text-heading-mobile text-ink md:text-heading">Notificações</h1>
      <p className="font-body text-body text-ink-muted">
        Receba no celular ou no computador os avisos das suas reservas, pagamentos e compras.
      </p>

      {status === 'loading' ? <Spinner label="Verificando notificações" /> : null}
      {explanation ? <Alert>{explanation}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      {status === 'off' ? (
        <Button loading={busy} onClick={() => void enable()}>
          Ativar notificações
        </Button>
      ) : null}
      {status === 'on' ? (
        <div className="space-y-space-sm">
          <Alert tone="success">As notificações estão ativas neste dispositivo.</Alert>
          <Button variant="secondary" loading={busy} onClick={() => void disable()}>
            Desativar
          </Button>
        </div>
      ) : null}

      <Button asChild variant="ghost" size="sm">
        <Link to="/app/perfil">Voltar ao perfil</Link>
      </Button>
    </div>
  );
}

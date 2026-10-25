import { useRegisterSW } from 'virtual:pwa-register/react';
import { useEffect } from 'react';
import { useToast } from '../components/ui/Toast';

/**
 * Registers the service worker and, when a new version is waiting, offers it in a toast.
 * "Atualizar" activates the waiting worker and reloads the page. Renders nothing itself.
 */
export function PwaUpdatePrompt() {
  const { toast } = useToast();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    if (!needRefresh) return;
    toast({
      message: 'Nova versão disponível',
      action: {
        label: 'Atualizar',
        onAction: () => {
          void updateServiceWorker(true);
        },
      },
    });
  }, [needRefresh, toast, updateServiceWorker]);

  return null;
}

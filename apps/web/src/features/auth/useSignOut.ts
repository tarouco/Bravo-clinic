import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLogout } from './hooks';

/** "Sair": ends the session on the server, then leaves the signed-in area for the Home. */
export function useSignOut(): { signOut: () => void; isPending: boolean; failed: boolean } {
  const navigate = useNavigate();
  const { mutateAsync, isPending } = useLogout();
  const [failed, setFailed] = useState(false);

  const signOut = useCallback(() => {
    setFailed(false);
    mutateAsync().then(
      () => {
        navigate('/', { replace: true });
      },
      () => {
        setFailed(true);
      },
    );
  }, [mutateAsync, navigate]);

  return { signOut, isPending, failed };
}

import { useEffect } from 'react';

const SUFFIX = 'Bravô Clinic – Salas Inteligentes';

/** Sets `document.title` to "<title> | Bravô Clinic – Salas Inteligentes" while the page is shown. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} | ${SUFFIX}`;
  }, [title]);
}

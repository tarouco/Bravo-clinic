/** Canonical URL used by `index.html` (Open Graph, JSON-LD) when `VITE_SITE_URL` is not set. */
export const DEFAULT_SITE_URL = 'https://www.bravoclinic.com.br';

/** The configured site URL without trailing slashes, or the default when it is unset or empty. */
export function resolveSiteUrl(configured: string | undefined): string {
  return (configured || DEFAULT_SITE_URL).replace(/\/+$/, '');
}

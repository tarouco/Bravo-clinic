/** Room photo variants written by the browser (AD-026): `large` ≤ 1600 px, `small` ≤ 800 px. */
export type PhotoVariant = 'large' | 'small';

/**
 * Same-origin URL of a room photo variant (GES-108). `storageKey` is `rooms/<roomId>/<uploadId>`;
 * the site proxies `/media/*` to the `room-photos` bucket.
 */
export function toPhotoUrl(storageKey: string, variant: PhotoVariant): string {
  return `/media/${storageKey}-${variant}.webp`;
}

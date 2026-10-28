// Room photos come in two browser-written variants (AD-026): `-large.webp` (≤ 1600 px wide) and
// `-small.webp` (≤ 800 px). The API returns the large URL; the small one follows by convention
// (design R13), so phones download half the bytes (GES-143).

const LARGE_SUFFIX = '-large.webp';

/** The `-small.webp` URL of a room photo, or null for any other image (placeholder, clinic photos). */
export function smallPhotoUrl(url: string): string | null {
  return url.endsWith(LARGE_SUFFIX) ? `${url.slice(0, -LARGE_SUFFIX.length)}-small.webp` : null;
}

/** `srcset` with both variants of a room photo; undefined for images without variants. */
export function photoSrcSet(url: string): string | undefined {
  const small = smallPhotoUrl(url);
  return small === null ? undefined : `${small} 800w, ${url} 1600w`;
}

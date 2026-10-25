import { describe, expect, it } from 'vitest';
import { toPhotoUrl } from './room-photo-url';

describe('toPhotoUrl (GES-108)', () => {
  it('builds the same-origin /media URL of each variant', () => {
    expect(toPhotoUrl('rooms/r1/u1', 'small')).toBe('/media/rooms/r1/u1-small.webp');
    expect(toPhotoUrl('rooms/r1/u1', 'large')).toBe('/media/rooms/r1/u1-large.webp');
  });
});

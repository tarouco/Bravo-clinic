import { describe, expect, it } from 'vitest';
import { photoSrcSet, smallPhotoUrl } from './room-photo';

describe('room photo variants (GES-143)', () => {
  it('derives the small variant of a room photo', () => {
    expect(smallPhotoUrl('/media/rooms/r1/u1-large.webp')).toBe('/media/rooms/r1/u1-small.webp');
  });

  it('offers both variants with their widths in the srcset', () => {
    expect(photoSrcSet('/media/rooms/r1/u1-large.webp')).toBe(
      '/media/rooms/r1/u1-small.webp 800w, /media/rooms/r1/u1-large.webp 1600w',
    );
  });

  it('leaves images without variants alone', () => {
    expect(smallPhotoUrl('/room-placeholder.webp')).toBeNull();
    expect(photoSrcSet('/images/sala-principal.webp')).toBeUndefined();
  });
});

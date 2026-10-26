import { describe, expect, it, vi } from 'vitest';
import { prepareRoomPhoto, type PhotoCanvas, type PrepareDeps } from './prepare-photo';

/** jsdom's Blob has no `text()`. */
function readText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as string);
    };
    reader.onerror = () => {
      reject(new Error('unreadable blob'));
    };
    reader.readAsText(blob);
  });
}

interface Drawn {
  width: number;
  height: number;
  type: string | undefined;
  quality: number | undefined;
}

/** A fake canvas that records its size and encodes a tiny blob of the requested type. */
function fakeDeps(
  source: { width: number; height: number },
  options: { blobType?: string | null; decodeFails?: boolean } = {},
) {
  const canvases: Drawn[] = [];
  const draws: { w: number; h: number }[] = [];
  const closed = vi.fn();
  const deps: PrepareDeps = {
    decode: () =>
      options.decodeFails
        ? Promise.reject(new Error('bad image'))
        : Promise.resolve({ ...source, close: closed }),
    createCanvas: (width, height): PhotoCanvas => {
      const record: Drawn = { width, height, type: undefined, quality: undefined };
      canvases.push(record);
      return {
        getContext: () => ({
          drawImage: (_image, _x, _y, w, h) => {
            draws.push({ w, h });
          },
        }),
        toBlob: (callback, type, quality) => {
          record.type = type;
          record.quality = quality;
          const blobType = options.blobType === undefined ? type : options.blobType;
          callback(
            blobType === null
              ? null
              : new Blob([`${String(width)}x${String(height)}`], { type: blobType }),
          );
        },
      };
    },
  };
  return { deps, canvases, draws, closed };
}

describe('prepareRoomPhoto (GES-109)', () => {
  it('returns a large WebP of 1600 px and a small one of 800 px on the longest side for 4000×3000', async () => {
    const { deps, canvases, draws } = fakeDeps({ width: 4000, height: 3000 });

    const result = await prepareRoomPhoto(
      new File(['x'], 'sala.jpg', { type: 'image/jpeg' }),
      deps,
    );

    expect(result.large.type).toBe('image/webp');
    expect(result.small.type).toBe('image/webp');
    expect(canvases.map((c) => [c.width, c.height])).toEqual([
      [1600, 1200],
      [800, 600],
    ]);
    expect(draws).toEqual([
      { w: 1600, h: 1200 },
      { w: 800, h: 600 },
    ]);
    expect(await readText(result.large)).toBe('1600x1200');
    expect(await readText(result.small)).toBe('800x600');
    expect({ width: result.width, height: result.height }).toEqual({ width: 1600, height: 1200 });
  });

  it('encodes WebP at quality 0.82', async () => {
    const { deps, canvases } = fakeDeps({ width: 4000, height: 3000 });

    await prepareRoomPhoto(new File(['x'], 'sala.jpg', { type: 'image/jpeg' }), deps);

    expect(canvases.map((c) => [c.type, c.quality])).toEqual([
      ['image/webp', 0.82],
      ['image/webp', 0.82],
    ]);
  });

  it('uses the height as the longest side of a portrait photo', async () => {
    const { deps, canvases } = fakeDeps({ width: 3000, height: 4000 });

    const result = await prepareRoomPhoto(new File(['x'], 'sala.jpg'), deps);

    expect(canvases.map((c) => [c.width, c.height])).toEqual([
      [1200, 1600],
      [600, 800],
    ]);
    expect({ width: result.width, height: result.height }).toEqual({ width: 1200, height: 1600 });
  });

  it('never enlarges a photo smaller than the targets', async () => {
    const { deps, canvases } = fakeDeps({ width: 1000, height: 500 });

    await prepareRoomPhoto(new File(['x'], 'sala.jpg'), deps);

    expect(canvases.map((c) => [c.width, c.height])).toEqual([
      [1000, 500],
      [800, 400],
    ]);
  });

  it('releases the decoded image', async () => {
    const { deps, closed } = fakeDeps({ width: 4000, height: 3000 });

    await prepareRoomPhoto(new File(['x'], 'sala.jpg'), deps);

    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('asks for a newer browser when WebP encoding is not supported', async () => {
    const { deps } = fakeDeps({ width: 4000, height: 3000 }, { blobType: 'image/png' });

    await expect(prepareRoomPhoto(new File(['x'], 'sala.jpg'), deps)).rejects.toThrow(
      'Use Chrome, Edge ou Firefox atualizados',
    );
  });

  it('asks for a newer browser when the encoder returns nothing', async () => {
    const { deps } = fakeDeps({ width: 4000, height: 3000 }, { blobType: null });

    await expect(prepareRoomPhoto(new File(['x'], 'sala.jpg'), deps)).rejects.toThrow(
      'Use Chrome, Edge ou Firefox atualizados',
    );
  });

  it('reports an unreadable image', async () => {
    const { deps } = fakeDeps({ width: 1, height: 1 }, { decodeFails: true });

    await expect(prepareRoomPhoto(new File(['x'], 'sala.jpg'), deps)).rejects.toThrow(
      'Não foi possível ler a imagem',
    );
  });
});

// Browser-side preparation of a room photo (AD-026, GES-109): the API never resizes images, so the
// browser produces the two WebP variants it stores, `large` (longest side up to 1600 px) and
// `small` (up to 800 px), and never enlarges a photo.

export const LARGE_MAX_SIDE = 1600;
export const SMALL_MAX_SIDE = 800;
export const WEBP_QUALITY = 0.82;

const UNSUPPORTED_MESSAGE = 'Use Chrome, Edge ou Firefox atualizados';
const UNREADABLE_MESSAGE = 'Não foi possível ler a imagem';

export interface DecodedImage {
  width: number;
  height: number;
  close?: () => void;
}

/** The part of a canvas the encoder needs; a fake in tests. */
export interface PhotoCanvas {
  getContext: (type: '2d') => {
    drawImage: (image: DecodedImage, x: number, y: number, width: number, height: number) => void;
  } | null;
  toBlob: (callback: (blob: Blob | null) => void, type: string, quality: number) => void;
}

export interface PrepareDeps {
  decode: (file: Blob) => Promise<DecodedImage>;
  createCanvas: (width: number, height: number) => PhotoCanvas;
}

export const browserDeps: PrepareDeps = {
  decode: (file) => createImageBitmap(file),
  createCanvas: (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas as unknown as PhotoCanvas;
  },
};

export interface PreparedPhoto {
  large: Blob;
  small: Blob;
  /** Size of the `large` variant, the one registered with the photo. */
  width: number;
  height: number;
}

function fit(width: number, height: number, maxSide: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const scale = maxSide / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function encode(
  deps: PrepareDeps,
  image: DecodedImage,
  size: { width: number; height: number },
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = deps.createCanvas(size.width, size.height);
    const context = canvas.getContext('2d');
    if (!context) {
      reject(new Error(UNSUPPORTED_MESSAGE));
      return;
    }
    context.drawImage(image, 0, 0, size.width, size.height);
    canvas.toBlob(
      (blob) => {
        // Browsers that cannot encode WebP fall back to PNG or return null.
        if (blob?.type === 'image/webp') resolve(blob);
        else reject(new Error(UNSUPPORTED_MESSAGE));
      },
      'image/webp',
      WEBP_QUALITY,
    );
  });
}

/** Decodes `file` and encodes its `large` and `small` WebP variants. */
export async function prepareRoomPhoto(
  file: Blob,
  deps: PrepareDeps = browserDeps,
): Promise<PreparedPhoto> {
  let image: DecodedImage;
  try {
    image = await deps.decode(file);
  } catch {
    throw new Error(UNREADABLE_MESSAGE);
  }
  try {
    const largeSize = fit(image.width, image.height, LARGE_MAX_SIDE);
    const smallSize = fit(image.width, image.height, SMALL_MAX_SIDE);
    const large = await encode(deps, image, largeSize);
    const small = await encode(deps, image, smallSize);
    return { large, small, width: largeSize.width, height: largeSize.height };
  } finally {
    image.close?.();
  }
}

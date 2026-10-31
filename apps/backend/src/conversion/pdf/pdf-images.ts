import { PNG } from 'pngjs';
import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Formati dei pixel restituiti da pdf.js (`ImageKind` nel codice di pdf.js). */
const IMAGE_KIND = { GRAYSCALE_1BPP: 1, RGB_24BPP: 2, RGBA_32BPP: 3 } as const;
const IMAGE_LOAD_TIMEOUT_MS = 5000;
/** Oltre questa soglia l'immagine decodificata occuperebbe troppa memoria (25 Mpx ≈ 100 MB RGBA). */
export const MAX_IMAGE_PIXELS = 25_000_000;

export interface DecodedImage {
  width: number;
  height: number;
  kind: number;
  data: Uint8Array | Uint8ClampedArray;
}

function isDecodedImage(value: unknown): value is DecodedImage {
  if (typeof value !== 'object' || value === null) return false;
  const image = value as Partial<DecodedImage>;
  return (
    typeof image.width === 'number' &&
    typeof image.height === 'number' &&
    typeof image.kind === 'number' &&
    (image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray)
  );
}

/** Recupera i pixel di un'immagine già decodificata da pdf.js durante `getOperatorList()`. */
export function loadPdfImage(page: PDFPageProxy, objectId: string): Promise<DecodedImage | null> {
  // Gli id che iniziano con "g_" sono condivisi tra le pagine.
  const store = objectId.startsWith('g_') ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), IMAGE_LOAD_TIMEOUT_MS);
    try {
      store.get(objectId, (value: unknown) => {
        clearTimeout(timer);
        resolve(isDecodedImage(value) ? value : null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/** Converte i pixel di pdf.js in RGBA, il formato richiesto da pngjs. */
export function toRgba(image: DecodedImage): Buffer | null {
  const { width, height, kind, data } = image;
  const rgba = Buffer.alloc(width * height * 4);
  if (kind === IMAGE_KIND.RGBA_32BPP) {
    if (data.length < rgba.length) return null;
    rgba.set(data.subarray(0, rgba.length));
    return rgba;
  }
  if (kind === IMAGE_KIND.RGB_24BPP) {
    if (data.length < width * height * 3) return null;
    for (let source = 0, target = 0; target < rgba.length; source += 3, target += 4) {
      rgba[target] = data[source]!;
      rgba[target + 1] = data[source + 1]!;
      rgba[target + 2] = data[source + 2]!;
      rgba[target + 3] = 255;
    }
    return rgba;
  }
  if (kind === IMAGE_KIND.GRAYSCALE_1BPP) {
    // Un bit per pixel, ogni riga allineata al byte. Bit a 1 = bianco (convenzione di pdf.js).
    const rowBytes = (width + 7) >> 3;
    if (data.length < rowBytes * height) return null;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bit = (data[y * rowBytes + (x >> 3)]! >> (7 - (x & 7))) & 1;
        const value = bit ? 255 : 0;
        const target = (y * width + x) * 4;
        rgba[target] = value;
        rgba[target + 1] = value;
        rgba[target + 2] = value;
        rgba[target + 3] = 255;
      }
    }
    return rgba;
  }
  return null;
}

export function encodePng(image: DecodedImage): Buffer | null {
  if (image.width <= 0 || image.height <= 0 || image.width * image.height > MAX_IMAGE_PIXELS)
    return null;
  const rgba = toRgba(image);
  if (!rgba) return null;
  const png = new PNG({ width: image.width, height: image.height });
  png.data = rgba;
  return PNG.sync.write(png);
}

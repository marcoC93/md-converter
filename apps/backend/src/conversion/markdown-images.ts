import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ImageMode, WarningCode } from '@md-converter/shared';

/** Un'immagine estratta su disco e il percorso con cui il Markdown la richiama. */
export interface ExtractedImage {
  sourcePath: string;
  referencePath: string;
}

export interface ImageFile {
  /** Percorso dentro lo ZIP finale, es. `images/image-001.png`. */
  archivePath: string;
  sourcePath: string;
}

export interface FinalizedMarkdown {
  markdown: string;
  imageFiles: ImageFile[];
  warnings: WarningCode[];
}

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.emf': 'image/emf',
  '.wmf': 'image/wmf',
};
/** Formati che quasi nessun visualizzatore Markdown sa mostrare. */
const POORLY_SUPPORTED = ['.emf', '.wmf', '.tif', '.tiff', '.bmp'];

export function imageMimeType(fileName: string): string | null {
  return MIME_TYPES[path.extname(fileName).toLowerCase()] ?? null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Sostituisce in un solo passaggio tutti i riferimenti noti; i più lunghi hanno la precedenza. */
function replaceReferences(markdown: string, replacements: ReadonlyMap<string, string>): string {
  if (replacements.size === 0) return markdown;
  const keys = [...replacements.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(keys.map(escapeRegExp).join('|'), 'g');
  return markdown.replace(pattern, (match) => replacements.get(match) ?? match);
}

/** Ordina le immagini secondo la prima apparizione nel testo; quelle mai citate vengono scartate. */
function referencedInOrder(markdown: string, images: readonly ExtractedImage[]): ExtractedImage[] {
  const variants = (image: ExtractedImage) => [
    image.referencePath,
    image.referencePath.replaceAll('/', '\\'),
  ];
  return images
    .map((image) => ({
      image,
      position: Math.min(
        ...variants(image)
          .map((variant) => markdown.indexOf(variant))
          .filter((index) => index >= 0),
      ),
    }))
    .filter((entry) => Number.isFinite(entry.position))
    .sort((a, b) => a.position - b.position)
    .map((entry) => entry.image);
}

function asSeparateFiles(
  markdown: string,
  images: readonly ExtractedImage[],
): { markdown: string; imageFiles: ImageFile[] } {
  const replacements = new Map<string, string>();
  const imageFiles = images.map((image, index) => {
    const extension =
      path
        .extname(image.sourcePath)
        .toLowerCase()
        .replace(/[^a-z0-9.]/g, '') || '.bin';
    const archivePath = `images/image-${String(index + 1).padStart(3, '0')}${extension}`;
    replacements.set(image.referencePath, archivePath);
    replacements.set(image.referencePath.replaceAll('/', '\\'), archivePath);
    return { archivePath, sourcePath: image.sourcePath };
  });
  return { markdown: replaceReferences(markdown, replacements), imageFiles };
}

/**
 * Applica la modalità immagini scelta dall'utente al Markdown prodotto da Pandoc o da pdf.js.
 * - `separate`: immagini rinominate in `images/image-001.png` (nomi sicuri, senza collisioni);
 * - `embedded`: immagini trasformate in data URI Base64. Se superano `maxEmbeddedBytes` si torna
 *   automaticamente a `separate` con l'avviso `EMBED_LIMIT_FALLBACK`.
 */
export async function finalizeMarkdownImages(
  markdown: string,
  extracted: readonly ExtractedImage[],
  imageMode: ImageMode,
  maxEmbeddedBytes: number,
): Promise<FinalizedMarkdown> {
  const images = referencedInOrder(markdown, extracted);
  const warnings: WarningCode[] = [];
  if (
    images.some((image) => POORLY_SUPPORTED.includes(path.extname(image.sourcePath).toLowerCase()))
  ) {
    warnings.push('UNSUPPORTED_IMAGE_FORMAT');
  }

  if (imageMode === 'embedded' && images.length > 0) {
    const sizes = await Promise.all(
      images.map(async (image) => (await stat(image.sourcePath)).size),
    );
    // Base64 aumenta la dimensione di circa 4/3.
    const encodedSize = sizes.reduce((sum, size) => sum + Math.ceil(size / 3) * 4, 0);
    if (encodedSize <= maxEmbeddedBytes) {
      const replacements = new Map<string, string>();
      for (const image of images) {
        const mime = imageMimeType(image.sourcePath) ?? 'application/octet-stream';
        const dataUri = `data:${mime};base64,${(await readFile(image.sourcePath)).toString('base64')}`;
        replacements.set(image.referencePath, dataUri);
        replacements.set(image.referencePath.replaceAll('/', '\\'), dataUri);
      }
      return { markdown: replaceReferences(markdown, replacements), imageFiles: [], warnings };
    }
    warnings.push('EMBED_LIMIT_FALLBACK');
  }

  return { ...asSeparateFiles(markdown, images), warnings };
}

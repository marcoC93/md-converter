import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { AppError } from '../../http/errors.js';

const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));

/** pdf.js vuole directory con barra finale; le barre "/" funzionano anche su Windows. */
function assetDir(name: string): string {
  return `${path.join(pdfjsRoot, name).replaceAll('\\', '/')}/`;
}

export interface OpenedPdf {
  document: PDFDocumentProxy;
  /** Libera la memoria usata da pdf.js. Va chiamata sempre, anche in caso di errore. */
  close: () => Promise<void>;
}

/**
 * Apre un PDF con pdf.js in modalità sicura: niente font di sistema, nessuna richiesta di rete.
 * CMap, font standard e decoder WASM sono letti dalla copia locale di pdfjs-dist.
 */
export async function openPdf(filePath: string): Promise<OpenedPdf> {
  const data = new Uint8Array(await readFile(filePath));
  const loadingTask = getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    cMapUrl: assetDir('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: assetDir('standard_fonts'),
    wasmUrl: assetDir('wasm'),
    verbosity: 0,
  });
  try {
    const document = await loadingTask.promise;
    return { document, close: () => loadingTask.destroy() };
  } catch (error) {
    await loadingTask.destroy();
    if (error instanceof Error && error.name === 'PasswordException') {
      throw new AppError('PDF_ENCRYPTED');
    }
    throw new AppError('INVALID_FILE_CONTENT', 'Il PDF è danneggiato o non leggibile.');
  }
}

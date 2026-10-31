/**
 * Tesseract è il motore OCR usato internamente da OCRmyPDF. Il backend lo chiama direttamente
 * solo per la diagnostica: versione e lingue installate.
 */
export const TESSERACT_LIST_LANGS_ARGS = ['--list-langs'];

export function parseTesseractVersion(output: string): string | null {
  return /tesseract\s+v?(\d+(?:\.\d+)+)/i.exec(output)?.[1] ?? null;
}

/**
 * L'output di `tesseract --list-langs` è simile a:
 *   List of available languages in "/usr/share/tesseract-ocr/5/tessdata/" (3):
 *   eng
 *   ita
 *   osd
 * `osd` (rilevamento dell'orientamento) non è una lingua di testo e viene escluso.
 */
export function parseTesseractLanguages(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[a-z]{3}(_[a-z]{3,4})?$/.test(line) && line !== 'osd')
    .sort();
}

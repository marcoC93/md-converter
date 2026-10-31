import type { DocumentFormat } from './formats.js';

export const CONVERSION_MODES = ['simple', 'high-fidelity'] as const;
export type ConversionMode = (typeof CONVERSION_MODES)[number];

/** Come trattare le immagini quando l'output è Markdown. */
export const IMAGE_MODES = ['separate', 'embedded'] as const;
export type ImageMode = (typeof IMAGE_MODES)[number];

export interface OcrOptions {
  enabled: boolean;
  /** Codici lingua Tesseract, es. `ita`, `eng`. Vengono combinati come `ita+eng`. */
  languages: string[];
  /** Esegue l'OCR anche sulle pagine che contengono già testo. */
  force: boolean;
}

export interface ConversionOptions {
  outputFormat: DocumentFormat;
  mode: ConversionMode;
  imageMode: ImageMode;
  ocr: OcrOptions;
}

export const DEFAULT_CONVERSION_OPTIONS: ConversionOptions = {
  outputFormat: 'docx',
  mode: 'simple',
  imageMode: 'separate',
  ocr: { enabled: false, languages: ['ita'], force: false },
};

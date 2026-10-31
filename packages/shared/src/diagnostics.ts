import type { DocumentFormat } from './formats.js';

export const TOOL_IDS = ['pandoc', 'libreoffice', 'tesseract', 'ocrmypdf'] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export interface ToolStatus {
  id: ToolId;
  available: boolean;
  version: string | null;
  /** Percorso dell'eseguibile con la home dell'utente abbreviata in `~`. */
  displayPath: string | null;
  /** Funzionalità abilitate da questo strumento, come codici (es. `md-to-docx`). */
  enables: string[];
  /** Solo Tesseract: lingue installate. */
  languages?: string[];
  /** Codice del problema rilevato, es. `NOT_FOUND`, `VERSION_TOO_OLD`. */
  problem: string | null;
}

export interface ConversionCapability {
  from: DocumentFormat;
  to: DocumentFormat;
  simple: boolean;
  highFidelity: boolean;
  /** OCR disponibile per questa conversione (solo da PDF). */
  ocr: boolean;
}

export interface DiagnosticsReport {
  checkedAt: string;
  platform: 'windows' | 'macos' | 'linux' | 'other';
  tools: ToolStatus[];
  capabilities: ConversionCapability[];
  /** Lingue OCR consentite dalla configurazione e installate in Tesseract. */
  ocrLanguages: string[];
}

export interface PublicConfig {
  maxFiles: number;
  maxFileSizeBytes: number;
  maxTotalSizeBytes: number;
  maxEmbeddedImagesBytes: number;
  allowedOcrLanguages: string[];
  conversionTimeoutSeconds: number;
}

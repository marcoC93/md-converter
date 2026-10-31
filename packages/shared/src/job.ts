import type { ErrorInfo, WarningCode } from './errors.js';
import type { DocumentFormat, InputKind } from './formats.js';
import type { ConversionOptions } from './options.js';

export const FILE_STATUSES = [
  'validating',
  'ready',
  'queued',
  'converting',
  'completed',
  'cancelled',
  'failed',
] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

/** Stati da cui un file non esce più. */
export const FINAL_FILE_STATUSES: readonly FileStatus[] = ['completed', 'cancelled', 'failed'];

export function isFinalStatus(status: FileStatus): boolean {
  return FINAL_FILE_STATUSES.includes(status);
}

export interface PdfAnalysis {
  pageCount: number;
  /** Caratteri estraibili in media per pagina. */
  averageCharsPerPage: number;
  /** Vero se il PDF sembra una scansione: l'interfaccia suggerisce l'OCR. */
  ocrSuggested: boolean;
}

export interface FileResult {
  /** Nome sicuro proposto per il download. */
  fileName: string;
  sizeBytes: number;
  /** Vero se il risultato è uno ZIP (Markdown con cartella `images/`). */
  isArchive: boolean;
  warnings: WarningCode[];
}

export interface FileSnapshot {
  id: string;
  /** Nome sanitizzato del file caricato, mostrato solo al browser che lo ha caricato. */
  displayName: string;
  inputKind: InputKind | null;
  sizeBytes: number;
  status: FileStatus;
  /** Avanzamento 0-100 quando misurabile, altrimenti `null`. */
  progress: number | null;
  /** Fase corrente in forma di codice, es. `ocr`, `extract`, `pandoc`. */
  stage: string | null;
  pdfAnalysis: PdfAnalysis | null;
  result: FileResult | null;
  error: ErrorInfo | null;
}

export interface JobSnapshot {
  id: string;
  createdAt: string;
  /** `null` finché la conversione non viene avviata. */
  options: ConversionOptions | null;
  started: boolean;
  files: FileSnapshot[];
  totalSizeBytes: number;
}

export interface JobReportEntry {
  fileId: string;
  displayName: string;
  status: FileStatus;
  outputFormat: DocumentFormat | null;
  resultFileName: string | null;
  errorCode: string | null;
  warnings: WarningCode[];
}

export interface JobReport {
  jobId: string;
  generatedAt: string;
  succeeded: number;
  failed: number;
  cancelled: number;
  entries: JobReportEntry[];
}

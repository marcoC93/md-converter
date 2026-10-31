/**
 * Codici di errore stabili. Il frontend li usa per mostrare messaggi tradotti:
 * non rinominarli senza aggiornare `docs/security.md` e i dizionari i18n.
 */
export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'MISSING_FILE',
  'TOO_MANY_FILES',
  'FORBIDDEN_REQUEST',
  'NOT_FOUND',
  'JOB_STATE_CONFLICT',
  'RESULT_NOT_READY',
  'FILE_TOO_LARGE',
  'TOTAL_SIZE_EXCEEDED',
  'UNSUPPORTED_FILE_TYPE',
  'INVALID_FILE_CONTENT',
  'UNSAFE_ARCHIVE',
  'INTERNAL_ERROR',
  'SERVICE_BUSY',
] as const;

/** Errori che possono colpire un singolo file durante la conversione. */
export const CONVERSION_ERROR_CODES = [
  'UNSUPPORTED_CONVERSION',
  'DEPENDENCY_MISSING',
  'OCR_LANGUAGE_NOT_AVAILABLE',
  'PDF_ENCRYPTED',
  'CONVERSION_FAILED',
  'CONVERSION_TIMEOUT',
  'OUTPUT_TOO_LARGE',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
export type ConversionErrorCode = (typeof CONVERSION_ERROR_CODES)[number];
export type ErrorCode = ApiErrorCode | ConversionErrorCode;

export interface ErrorInfo {
  code: ErrorCode;
  /** Messaggio in italiano pensato per l'utente finale. */
  message: string;
  details?: string;
  correlationId: string;
}

export interface ApiErrorBody {
  error: ErrorInfo;
}

/** Avvisi non bloccanti associati a un risultato. */
export const WARNING_CODES = [
  'EMBED_LIMIT_FALLBACK',
  'UNSUPPORTED_IMAGE_FORMAT',
  'IMAGES_NOT_FOUND',
  'REMOTE_IMAGES_BLOCKED',
  'NO_TEXT_EXTRACTED',
  'IMAGES_SKIPPED',
  'LAYOUT_NOT_PRESERVED',
] as const;
export type WarningCode = (typeof WARNING_CODES)[number];

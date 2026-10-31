import type { ApiErrorCode, ErrorCode, ErrorInfo } from '@md-converter/shared';

const HTTP_STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  MISSING_FILE: 400,
  TOO_MANY_FILES: 400,
  FORBIDDEN_REQUEST: 403,
  NOT_FOUND: 404,
  JOB_STATE_CONFLICT: 409,
  RESULT_NOT_READY: 409,
  FILE_TOO_LARGE: 413,
  TOTAL_SIZE_EXCEEDED: 413,
  UNSUPPORTED_FILE_TYPE: 415,
  INVALID_FILE_CONTENT: 415,
  UNSAFE_ARCHIVE: 415,
  INTERNAL_ERROR: 500,
  SERVICE_BUSY: 503,
};

/** Messaggi predefiniti in italiano. Il frontend può tradurli usando il codice. */
const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'La richiesta contiene dati non validi.',
  MISSING_FILE: 'Nessun file ricevuto.',
  TOO_MANY_FILES: 'Hai raggiunto il numero massimo di file per conversione.',
  FORBIDDEN_REQUEST: 'Richiesta rifiutata per motivi di sicurezza.',
  NOT_FOUND: 'Elemento non trovato. Potrebbe essere già stato eliminato.',
  JOB_STATE_CONFLICT: 'Operazione non consentita nello stato attuale.',
  RESULT_NOT_READY: 'Il risultato non è ancora disponibile.',
  FILE_TOO_LARGE: 'Il file supera la dimensione massima consentita.',
  TOTAL_SIZE_EXCEEDED: 'La dimensione complessiva dei file supera il limite consentito.',
  UNSUPPORTED_FILE_TYPE: 'Tipo di file non supportato.',
  INVALID_FILE_CONTENT: 'Il contenuto del file non corrisponde al formato indicato.',
  UNSAFE_ARCHIVE: "L'archivio contiene percorsi o dimensioni non sicuri.",
  INTERNAL_ERROR: 'Si è verificato un errore imprevisto.',
  SERVICE_BUSY: 'Il servizio è occupato. Riprova tra poco.',
  UNSUPPORTED_CONVERSION: 'Questa conversione non è supportata.',
  DEPENDENCY_MISSING: 'Uno strumento necessario per questa conversione non è installato.',
  OCR_LANGUAGE_NOT_AVAILABLE: 'La lingua OCR richiesta non è installata.',
  PDF_ENCRYPTED: 'Il PDF è protetto da password e non può essere convertito.',
  CONVERSION_FAILED: 'Non è stato possibile convertire il documento.',
  CONVERSION_TIMEOUT: 'La conversione ha superato il tempo massimo consentito.',
  OUTPUT_TOO_LARGE: 'Il documento risultante supera la dimensione massima consentita.',
};

/**
 * Errore previsto, con codice stabile. Il messaggio e i dettagli vengono mostrati all'utente,
 * quindi non devono contenere percorsi, comandi o contenuto dei documenti.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: string | undefined;

  constructor(code: ErrorCode, details?: string, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    this.statusCode = code in HTTP_STATUS ? HTTP_STATUS[code as ApiErrorCode] : 500;
  }

  toInfo(correlationId: string): ErrorInfo {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
      correlationId,
    };
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

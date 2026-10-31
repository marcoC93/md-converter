import type {
  ApiErrorBody,
  ConversionOptions,
  DiagnosticsReport,
  FileSnapshot,
  JobSnapshot,
  PublicConfig,
} from '@md-converter/shared';

/** Errore restituito dal client. `code` è un codice stabile del backend oppure `NETWORK_ERROR`. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: string,
    readonly correlationId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as ApiErrorBody).error?.code === 'string'
  );
}

function toApiError(status: number, body: unknown): ApiError {
  if (isApiErrorBody(body)) {
    const { code, message, details, correlationId } = body.error;
    return new ApiError(code, message, status, details, correlationId);
  }
  return new ApiError('INTERNAL_ERROR', 'Risposta inattesa dal servizio.', status);
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', 'Servizio non raggiungibile.', 0);
  }
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw toApiError(response.status, data);
  return data as T;
}

export const api = {
  getConfig: () => request<PublicConfig>('GET', '/api/config'),
  getDiagnostics: (refresh = false) =>
    request<DiagnosticsReport>('GET', `/api/diagnostics${refresh ? '?refresh=true' : ''}`),
  createJob: () => request<JobSnapshot>('POST', '/api/jobs'),
  getJob: (jobId: string) => request<JobSnapshot>('GET', `/api/jobs/${jobId}`),
  deleteJob: (jobId: string) => request<void>('DELETE', `/api/jobs/${jobId}`),
  startJob: (jobId: string, options: ConversionOptions) =>
    request<JobSnapshot>('POST', `/api/jobs/${jobId}/start`, options),
  cancelJob: (jobId: string) => request<JobSnapshot>('POST', `/api/jobs/${jobId}/cancel`),
  cancelFile: (jobId: string, fileId: string) =>
    request<JobSnapshot>('POST', `/api/jobs/${jobId}/files/${fileId}/cancel`),
  removeFile: (jobId: string, fileId: string) =>
    request<void>('DELETE', `/api/jobs/${jobId}/files/${fileId}`),
  downloadUrl: (jobId: string, fileId: string) => `/api/jobs/${jobId}/files/${fileId}/download`,
  archiveUrl: (jobId: string) => `/api/jobs/${jobId}/archive`,
  eventsUrl: (jobId: string) => `/api/jobs/${jobId}/events`,
};

export interface UploadHandle {
  promise: Promise<FileSnapshot>;
  abort: () => void;
}

/**
 * Carica un file con XMLHttpRequest invece di fetch: XHR espone l'avanzamento dell'upload,
 * così l'interfaccia può mostrare una barra di progresso reale.
 */
export function uploadFile(
  jobId: string,
  file: File,
  onProgress: (percent: number) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<FileSnapshot>((resolve, reject) => {
    xhr.open('POST', `/api/jobs/${jobId}/files`);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as FileSnapshot);
      else reject(toApiError(xhr.status, xhr.response));
    };
    xhr.onerror = () => reject(new ApiError('NETWORK_ERROR', 'Servizio non raggiungibile.', 0));
    xhr.onabort = () => reject(new ApiError('CANCELLED', 'Caricamento annullato.', 0));
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

/** Avvia un download facendo seguire al browser un link temporaneo (stessa origine). */
export function triggerDownload(url: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = '';
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

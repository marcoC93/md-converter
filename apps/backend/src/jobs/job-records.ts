import type {
  ConversionOptions,
  ErrorInfo,
  FileSnapshot,
  FileStatus,
  InputKind,
  JobReport,
  JobSnapshot,
  PdfAnalysis,
} from '@md-converter/shared';
import type { ConversionOutcome } from '../conversion/run-conversion.js';

/** Stato interno di un file. Contiene percorsi reali: non va mai inviato così com'è al browser. */
export interface FileRecord {
  id: string;
  displayName: string;
  inputKind: InputKind | null;
  sizeBytes: number;
  status: FileStatus;
  progress: number | null;
  stage: string | null;
  pdfAnalysis: PdfAnalysis | null;
  error: ErrorInfo | null;
  inputPath: string | null;
  outcome: ConversionOutcome | null;
  abortController: AbortController;
  downloaded: boolean;
}

export interface JobRecord {
  id: string;
  createdAt: Date;
  lastActivityAt: number;
  options: ConversionOptions | null;
  started: boolean;
  files: Map<string, FileRecord>;
  cleanupTimer: NodeJS.Timeout | null;
}

export function totalSize(job: JobRecord): number {
  let total = 0;
  for (const file of job.files.values()) total += file.sizeBytes;
  return total;
}

function fileSnapshot(file: FileRecord): FileSnapshot {
  return {
    id: file.id,
    displayName: file.displayName,
    inputKind: file.inputKind,
    sizeBytes: file.sizeBytes,
    status: file.status,
    progress: file.progress,
    stage: file.stage,
    pdfAnalysis: file.pdfAnalysis,
    result: file.outcome
      ? {
          fileName: file.outcome.fileName,
          sizeBytes: file.outcome.sizeBytes,
          isArchive: file.outcome.isArchive,
          warnings: file.outcome.warnings,
        }
      : null,
    error: file.error,
  };
}

/** Versione pubblica dello stato del job: solo dati utili al browser, nessun percorso. */
export function jobSnapshot(job: JobRecord): JobSnapshot {
  return {
    id: job.id,
    createdAt: job.createdAt.toISOString(),
    options: job.options,
    started: job.started,
    files: [...job.files.values()].map(fileSnapshot),
    totalSizeBytes: totalSize(job),
  };
}

/** Report incluso nello ZIP complessivo: esiti e codici di errore, senza dettagli sensibili. */
export function buildReport(job: JobRecord, resultNames: ReadonlyMap<string, string>): JobReport {
  const files = [...job.files.values()];
  return {
    jobId: job.id,
    generatedAt: new Date().toISOString(),
    succeeded: files.filter((file) => file.status === 'completed').length,
    failed: files.filter((file) => file.status === 'failed').length,
    cancelled: files.filter((file) => file.status === 'cancelled').length,
    entries: files.map((file) => ({
      fileId: file.id,
      displayName: file.displayName,
      status: file.status,
      outputFormat: job.options?.outputFormat ?? null,
      resultFileName: resultNames.get(file.id) ?? null,
      errorCode: file.error?.code ?? null,
      warnings: file.outcome?.warnings ?? [],
    })),
  };
}

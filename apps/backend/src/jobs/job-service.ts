import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type { ConversionOptions, ErrorInfo, FileStatus, JobSnapshot } from '@md-converter/shared';
import type { FastifyBaseLogger } from 'fastify';
import { analyzePdf } from '../conversion/pdf/pdf-analysis.js';
import { runConversion, type ConversionEnvironment } from '../conversion/run-conversion.js';
import {
  detectInputKind,
  isDeclaredMimeAccepted,
  validateFileContent,
} from '../files/file-validation.js';
import { sanitizeFileName, splitExtension, uniqueFileName } from '../files/sanitize-filename.js';
import type { TempStore } from '../files/temp-store.js';
import type { ZipLimits } from '../files/zip-inspect.js';
import { createZipStream, type ZipSource } from '../files/zip-writer.js';
import { AppError, isAppError } from '../http/errors.js';
import { CancelledError } from '../tools/tool-executor.js';
import { ConversionQueue } from './conversion-queue.js';
import { assertTransition, isCancellable } from './file-state.js';
import {
  buildReport,
  jobSnapshot,
  totalSize,
  type FileRecord,
  type JobRecord,
} from './job-records.js';
import type { JobEvents } from './job-events.js';
import { saveUpload, type IncomingFile } from './upload.js';

/** Lo stato può essere cambiato da un annullamento mentre la conversione è in corso. */
function isConverting(file: FileRecord): boolean {
  return file.status === 'converting';
}

export interface JobServiceLimits {
  maxFilesPerJob: number;
  maxFileSizeBytes: number;
  maxTotalSizeBytes: number;
  maxActiveJobs: number;
  maxConcurrentJobs: number;
  jobTtlMs: number;
  cleanupAfterDownloadMs: number;
  zipLimits: ZipLimits;
}

export interface DownloadInfo {
  filePath: string;
  fileName: string;
  sizeBytes: number;
  isArchive: boolean;
}

/** Ambiente di conversione senza i campi che dipendono dal singolo file. */
export type ConversionRuntime = Omit<ConversionEnvironment, 'removeDir' | 'logUnexpectedError'>;

/**
 * Coordina il ciclo di vita dei job: creazione, upload, validazione, coda di conversione,
 * annullamento, download e pulizia. Lo stato è in memoria; i file stanno in TempStore.
 */
export class JobService {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly queue: ConversionQueue;
  private shuttingDown = false;

  constructor(
    private readonly tempStore: TempStore,
    private readonly events: JobEvents,
    private readonly runtime: ConversionRuntime,
    private readonly limits: JobServiceLimits,
    private readonly logger: FastifyBaseLogger,
  ) {
    this.queue = new ConversionQueue(limits.maxConcurrentJobs);
  }

  get activeJobIds(): ReadonlySet<string> {
    return new Set(this.jobs.keys());
  }

  async createJob(): Promise<JobSnapshot> {
    if (this.shuttingDown) throw new AppError('SERVICE_BUSY');
    if (this.jobs.size >= this.limits.maxActiveJobs) {
      await this.removeExpiredJobs();
      if (this.jobs.size >= this.limits.maxActiveJobs)
        throw new AppError('SERVICE_BUSY', 'Troppi job attivi: elimina quelli completati.');
    }
    const id = randomUUID();
    await this.tempStore.createJobDirs(id);
    const job: JobRecord = {
      id,
      createdAt: new Date(),
      lastActivityAt: Date.now(),
      options: null,
      started: false,
      files: new Map(),
      cleanupTimer: null,
      revision: 0,
    };
    this.jobs.set(id, job);
    this.logger.info({ jobId: id }, 'job created');
    return jobSnapshot(job);
  }

  getJob(jobId: string): JobSnapshot {
    return jobSnapshot(this.requireJob(jobId));
  }

  /** Riceve un file, lo salva in streaming e lo valida. In caso di errore il file viene scartato. */
  async addFile(jobId: string, incoming: IncomingFile): Promise<JobSnapshot['files'][number]> {
    const job = this.requireJob(jobId);
    try {
      if (job.started)
        throw new AppError(
          'JOB_STATE_CONFLICT',
          'La conversione è già stata avviata: crea un nuovo job.',
        );
      if (job.files.size >= this.limits.maxFilesPerJob)
        throw new AppError('TOO_MANY_FILES', `Massimo ${this.limits.maxFilesPerJob} file.`);
      const inputKind = detectInputKind(incoming.fileName);
      if (!inputKind)
        throw new AppError(
          'UNSUPPORTED_FILE_TYPE',
          'Formati ammessi: .md, .markdown, .zip (Markdown con immagini), .docx, .pdf.',
        );
      if (!isDeclaredMimeAccepted(inputKind, incoming.mimeType))
        throw new AppError('UNSUPPORTED_FILE_TYPE', "Il tipo MIME non corrisponde all'estensione.");
    } catch (error) {
      incoming.stream.resume();
      throw error;
    }

    const inputKind = detectInputKind(incoming.fileName)!;
    const file: FileRecord = {
      id: randomUUID(),
      displayName: sanitizeFileName(incoming.fileName),
      inputKind,
      sizeBytes: 0,
      status: 'validating',
      progress: null,
      stage: null,
      pdfAnalysis: null,
      error: null,
      inputPath: null,
      outcome: null,
      abortController: new AbortController(),
      downloaded: false,
    };
    job.files.set(file.id, file);
    this.touch(job);

    // Sul disco il file prende un nome interno: il nome originale non tocca mai il filesystem.
    const inputPath = path.join(
      this.tempStore.jobPaths(job.id).input,
      `${file.id}${splitExtension(incoming.fileName).extension}`,
    );
    try {
      const remainingTotal = this.limits.maxTotalSizeBytes - totalSize(job);
      const perFileIsTighter = this.limits.maxFileSizeBytes <= remainingTotal;
      file.sizeBytes = await saveUpload(
        incoming,
        inputPath,
        Math.min(this.limits.maxFileSizeBytes, remainingTotal),
        perFileIsTighter ? 'FILE_TOO_LARGE' : 'TOTAL_SIZE_EXCEEDED',
      );
      file.inputPath = inputPath;
      await validateFileContent(inputPath, inputKind, this.limits.zipLimits);
      if (inputKind === 'pdf') file.pdfAnalysis = await analyzePdf(inputPath);
      if (file.abortController.signal.aborted || !job.files.has(file.id)) {
        throw new AppError('NOT_FOUND', 'Il file è stato rimosso durante il caricamento.');
      }
      this.setStatus(job, file, 'ready');
      return jobSnapshot(job).files.find((entry) => entry.id === file.id)!;
    } catch (error) {
      job.files.delete(file.id);
      await rm(inputPath, { force: true });
      this.publish(job);
      if (error instanceof AppError && error.code === 'PDF_ENCRYPTED') {
        throw new AppError(
          'INVALID_FILE_CONTENT',
          'Il PDF è protetto da password e non può essere convertito.',
        );
      }
      throw error;
    }
  }

  start(jobId: string, options: ConversionOptions): JobSnapshot {
    const job = this.requireJob(jobId);
    if (job.started)
      throw new AppError('JOB_STATE_CONFLICT', 'La conversione è già stata avviata.');
    const readyFiles = [...job.files.values()].filter((file) => file.status === 'ready');
    if (readyFiles.length === 0)
      throw new AppError('JOB_STATE_CONFLICT', 'Nessun file pronto da convertire.');

    job.options = options;
    job.started = true;
    for (const file of readyFiles) {
      this.setStatus(job, file, 'queued', false);
      this.queue.enqueue(() => this.convertFile(job, file));
    }
    this.publish(job);
    this.logger.info(
      {
        jobId,
        files: readyFiles.length,
        outputFormat: options.outputFormat,
        mode: options.mode,
        ocr: options.ocr.enabled,
      },
      'job started',
    );
    return jobSnapshot(job);
  }

  cancelFile(jobId: string, fileId: string): JobSnapshot {
    const job = this.requireJob(jobId);
    const file = this.requireFile(job, fileId);
    if (!isCancellable(file.status))
      throw new AppError('JOB_STATE_CONFLICT', 'Il file non può più essere annullato.');
    this.cancel(job, file);
    this.publish(job);
    return jobSnapshot(job);
  }

  cancelJob(jobId: string): JobSnapshot {
    const job = this.requireJob(jobId);
    for (const file of job.files.values()) {
      if (isCancellable(file.status)) this.cancel(job, file);
    }
    this.publish(job);
    return jobSnapshot(job);
  }

  async removeFile(jobId: string, fileId: string): Promise<void> {
    const job = this.requireJob(jobId);
    const file = this.requireFile(job, fileId);
    file.abortController.abort();
    job.files.delete(fileId);
    if (file.inputPath) await rm(file.inputPath, { force: true });
    await this.tempStore.removeInside(this.fileOutputDir(job, file)).catch(() => undefined);
    this.touch(job);
    this.publish(job);
  }

  async deleteJob(jobId: string): Promise<void> {
    const job = this.requireJob(jobId);
    await this.destroyJob(job, 'deleted by user');
  }

  getDownload(jobId: string, fileId: string): DownloadInfo {
    const job = this.requireJob(jobId);
    const file = this.requireFile(job, fileId);
    if (file.status !== 'completed' || !file.outcome) throw new AppError('RESULT_NOT_READY');
    this.touch(job);
    return {
      filePath: file.outcome.outputPath,
      fileName: file.outcome.fileName,
      sizeBytes: file.outcome.sizeBytes,
      isArchive: file.outcome.isArchive,
    };
  }

  /** Da chiamare quando il download è terminato: programma la pulizia se tutto è stato scaricato. */
  markDownloaded(jobId: string, fileIds: readonly string[]): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    for (const fileId of fileIds) {
      const file = job.files.get(fileId);
      if (file) file.downloaded = true;
    }
    const files = [...job.files.values()];
    const allFinal = files.every((file) =>
      ['completed', 'failed', 'cancelled'].includes(file.status),
    );
    const allDownloaded = files
      .filter((file) => file.status === 'completed')
      .every((file) => file.downloaded);
    if (allFinal && allDownloaded) this.scheduleCleanup(job);
  }

  /** ZIP con tutti i risultati e `report.json`. I nomi sono resi unici per evitare collisioni. */
  createArchive(jobId: string): { stream: Readable; fileName: string; fileIds: string[] } {
    const job = this.requireJob(jobId);
    const completed = [...job.files.values()].filter(
      (file) => file.status === 'completed' && file.outcome,
    );
    if (completed.length === 0)
      throw new AppError('RESULT_NOT_READY', 'Nessun risultato da scaricare.');

    const usedNames = new Set<string>(['report.json']);
    const resultNames = new Map<string, string>();
    const sources: ZipSource[] = completed.map((file) => {
      const archivePath = uniqueFileName(file.outcome!.fileName, usedNames);
      resultNames.set(file.id, archivePath);
      return { archivePath, filePath: file.outcome!.outputPath };
    });
    sources.push({
      archivePath: 'report.json',
      content: JSON.stringify(buildReport(job, resultNames), null, 2),
    });
    this.touch(job);
    // Nome prevedibile e sicuro: data + prime cifre dell'ID, nessun nome di file dell'utente.
    const fileName = `conversioni-${new Date().toISOString().slice(0, 10)}-${job.id.slice(0, 8)}.zip`;
    return {
      stream: createZipStream(sources),
      fileName,
      fileIds: completed.map((file) => file.id),
    };
  }

  /** Elimina i job inattivi da più del TTL. Non tocca i job con conversioni in corso. */
  async removeExpiredJobs(now = Date.now()): Promise<number> {
    let removed = 0;
    for (const job of [...this.jobs.values()]) {
      const busy = [...job.files.values()].some(
        (file) =>
          file.status === 'converting' || file.status === 'queued' || file.status === 'validating',
      );
      if (!busy && now - job.lastActivityAt > this.limits.jobTtlMs) {
        await this.destroyJob(job, 'expired');
        removed++;
      }
    }
    return removed;
  }

  /** Arresto controllato: annulla tutto, attende la coda e cancella le directory temporanee. */
  async shutdown(timeoutMs = 10_000): Promise<void> {
    this.shuttingDown = true;
    for (const job of this.jobs.values()) {
      for (const file of job.files.values()) file.abortController.abort();
    }
    await Promise.race([
      this.queue.onIdle(),
      new Promise((resolve) => setTimeout(resolve, timeoutMs).unref()),
    ]);
    for (const job of [...this.jobs.values()]) await this.destroyJob(job, 'shutdown');
  }

  /** Attende che la coda sia vuota (usato nei test). */
  waitForIdle(): Promise<void> {
    return this.queue.onIdle();
  }

  private async convertFile(job: JobRecord, file: FileRecord): Promise<void> {
    if (
      file.status !== 'queued' ||
      !this.jobs.has(job.id) ||
      !job.options ||
      !file.inputPath ||
      !file.inputKind
    )
      return;
    this.setStatus(job, file, 'converting');
    const jobPaths = this.tempStore.jobPaths(job.id);
    const startedAt = Date.now();
    try {
      const outcome = await runConversion(
        {
          inputPath: file.inputPath,
          inputKind: file.inputKind,
          outputBaseName: splitExtension(file.displayName).base,
          options: job.options,
          workDir: path.join(jobPaths.work, file.id),
          outputDir: this.fileOutputDir(job, file),
          signal: file.abortController.signal,
          onProgress: (stage, progress) => this.updateProgress(job, file, stage, progress),
        },
        {
          ...this.runtime,
          removeDir: (dir) => this.tempStore.removeInside(dir),
          logUnexpectedError: (error) =>
            this.logger.error(
              { err: error, jobId: job.id, fileId: file.id },
              'unexpected conversion error',
            ),
        },
      );
      if (!isConverting(file)) return;
      file.outcome = outcome;
      file.progress = 100;
      this.setStatus(job, file, 'completed');
      this.logger.info(
        { jobId: job.id, fileId: file.id, durationMs: Date.now() - startedAt },
        'file converted',
      );
    } catch (error) {
      await this.tempStore.removeInside(this.fileOutputDir(job, file)).catch(() => undefined);
      if (!isConverting(file)) return;
      if (error instanceof CancelledError) {
        this.setStatus(job, file, 'cancelled');
        return;
      }
      file.error = this.toErrorInfo(error, job, file);
      this.setStatus(job, file, 'failed');
    }
  }

  private toErrorInfo(error: unknown, job: JobRecord, file: FileRecord): ErrorInfo {
    const correlationId = randomUUID();
    const appError = isAppError(error) ? error : new AppError('INTERNAL_ERROR');
    if (!isAppError(error))
      this.logger.error(
        { err: error, jobId: job.id, fileId: file.id, correlationId },
        'unexpected error',
      );
    else
      this.logger.warn(
        { jobId: job.id, fileId: file.id, code: appError.code, correlationId },
        'file conversion failed',
      );
    return appError.toInfo(correlationId);
  }

  private cancel(job: JobRecord, file: FileRecord): void {
    file.abortController.abort();
    this.setStatus(job, file, 'cancelled', false);
    file.progress = null;
  }

  private updateProgress(
    job: JobRecord,
    file: FileRecord,
    stage: string,
    progress: number | null,
  ): void {
    if (file.status !== 'converting') return;
    if (file.stage === stage && file.progress === progress) return;
    file.stage = stage;
    file.progress = progress;
    this.touch(job);
    this.publish(job);
  }

  private setStatus(job: JobRecord, file: FileRecord, status: FileStatus, publish = true): void {
    assertTransition(file.status, status);
    file.status = status;
    if (status !== 'converting') file.stage = null;
    this.touch(job);
    if (publish) this.publish(job);
  }

  private fileOutputDir(job: JobRecord, file: FileRecord): string {
    return path.join(this.tempStore.jobPaths(job.id).output, file.id);
  }

  private scheduleCleanup(job: JobRecord): void {
    if (job.cleanupTimer) clearTimeout(job.cleanupTimer);
    job.cleanupTimer = setTimeout(() => {
      void this.destroyJob(job, 'downloaded').catch((error: unknown) =>
        this.logger.error({ err: error, jobId: job.id }, 'cleanup failed'),
      );
    }, this.limits.cleanupAfterDownloadMs);
    job.cleanupTimer.unref();
  }

  private async destroyJob(job: JobRecord, reason: string): Promise<void> {
    if (job.cleanupTimer) clearTimeout(job.cleanupTimer);
    for (const file of job.files.values()) file.abortController.abort();
    this.jobs.delete(job.id);
    this.events.publish(job.id, { type: 'deleted' });
    await this.tempStore.removeJobDir(job.id);
    this.logger.info({ jobId: job.id, reason }, 'job removed');
  }

  private touch(job: JobRecord): void {
    job.lastActivityAt = Date.now();
  }

  /** Ogni modifica dello stato passa da qui: la revisione cresce prima di notificarla. */
  private publish(job: JobRecord): void {
    job.revision++;
    if (this.jobs.has(job.id)) this.events.publish(job.id, { type: 'job', job: jobSnapshot(job) });
  }

  private requireJob(jobId: string): JobRecord {
    const job = this.jobs.get(jobId);
    if (!job) throw new AppError('NOT_FOUND', 'Job inesistente o scaduto.');
    return job;
  }

  private requireFile(job: JobRecord, fileId: string): FileRecord {
    const file = job.files.get(fileId);
    if (!file) throw new AppError('NOT_FOUND', 'File inesistente.');
    return file;
  }
}

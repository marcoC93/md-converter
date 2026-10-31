import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ConversionOptions, InputKind, ToolId, WarningCode } from '@md-converter/shared';
import { AppError, isAppError } from '../http/errors.js';
import { CancelledError, type ToolExecutor } from '../tools/tool-executor.js';
import { requiredTools, selectPipeline } from './pipeline-selector.js';
import type { PipelineLimits } from './pipeline-types.js';

export interface ConversionRequest {
  inputPath: string;
  inputKind: InputKind;
  outputBaseName: string;
  options: ConversionOptions;
  workDir: string;
  outputDir: string;
  signal: AbortSignal;
  onProgress: (stage: string, progress: number | null) => void;
}

export interface ConversionEnvironment {
  executor: ToolExecutor;
  isToolAvailable: (tool: ToolId) => boolean;
  installedOcrLanguages: () => readonly string[];
  timeoutMs: number;
  maxOutputSizeBytes: number;
  limits: PipelineLimits;
  /** Cancella in sicurezza una directory del job (vedi TempStore.removeInside). */
  removeDir: (dir: string) => Promise<void>;
  /** Registra gli errori imprevisti (con stack trace) solo nei log del server. */
  logUnexpectedError: (error: unknown) => void;
}

export interface ConversionOutcome {
  outputPath: string;
  fileName: string;
  sizeBytes: number;
  isArchive: boolean;
  warnings: WarningCode[];
}

/** Controlla prima di iniziare che strumenti e lingue OCR siano disponibili. */
function checkRequirements(request: ConversionRequest, environment: ConversionEnvironment) {
  const pipeline = selectPipeline(request.inputKind, request.options);
  if (!pipeline) {
    throw new AppError(
      'UNSUPPORTED_CONVERSION',
      'Il file è già nel formato scelto oppure la coppia di formati non è supportata.',
    );
  }
  const ocrEnabled = pipeline.supportsOcr && request.options.ocr.enabled;
  const missing = requiredTools(pipeline, ocrEnabled).filter(
    (tool) => !environment.isToolAvailable(tool),
  );
  if (missing.length > 0) {
    throw new AppError(
      'DEPENDENCY_MISSING',
      `Strumenti mancanti: ${missing.join(', ')}. Controlla il pannello Diagnostica.`,
    );
  }
  if (ocrEnabled) {
    const installed = environment.installedOcrLanguages();
    const unavailable = request.options.ocr.languages.filter((code) => !installed.includes(code));
    if (unavailable.length > 0) {
      throw new AppError(
        'OCR_LANGUAGE_NOT_AVAILABLE',
        `Lingue non installate: ${unavailable.join(', ')}.`,
      );
    }
  }
  // Se la pipeline non usa l'OCR, l'opzione viene ignorata invece di bloccare la conversione.
  const options: ConversionOptions = ocrEnabled
    ? request.options
    : { ...request.options, ocr: { ...request.options.ocr, enabled: false } };
  return { pipeline, options };
}

/**
 * Esegue la pipeline corretta per un file, con timeout complessivo, annullamento,
 * controllo della dimensione del risultato e pulizia della directory di lavoro.
 */
export async function runConversion(
  request: ConversionRequest,
  environment: ConversionEnvironment,
): Promise<ConversionOutcome> {
  const { pipeline, options } = checkRequirements(request, environment);
  await mkdir(request.workDir, { recursive: true });
  await mkdir(request.outputDir, { recursive: true });

  const timeoutSignal = AbortSignal.timeout(environment.timeoutMs);
  const signal = AbortSignal.any([request.signal, timeoutSignal]);
  try {
    const result = await pipeline.run({
      inputPath: request.inputPath,
      inputKind: request.inputKind,
      workDir: request.workDir,
      outputDir: request.outputDir,
      outputBaseName: request.outputBaseName,
      options,
      executor: environment.executor,
      signal,
      timeoutMs: environment.timeoutMs,
      limits: environment.limits,
      reportProgress: request.onProgress,
    });

    const { size } = await stat(result.outputPath);
    if (size > environment.maxOutputSizeBytes) {
      await rm(result.outputPath, { force: true });
      throw new AppError('OUTPUT_TOO_LARGE');
    }
    return { ...result, sizeBytes: size, outputPath: path.resolve(result.outputPath) };
  } catch (error) {
    if (request.signal.aborted) throw new CancelledError();
    if (timeoutSignal.aborted) throw new AppError('CONVERSION_TIMEOUT');
    if (isAppError(error) || error instanceof CancelledError) throw error;
    environment.logUnexpectedError(error);
    throw new AppError(
      'CONVERSION_FAILED',
      'Errore durante la conversione. Il file potrebbe essere danneggiato o non supportato.',
    );
  } finally {
    await environment.removeDir(request.workDir).catch(() => undefined);
  }
}

import type { ConversionOptions, InputKind, WarningCode } from '@md-converter/shared';
import type { ZipLimits } from '../files/zip-inspect.js';
import type { ToolExecutor } from '../tools/tool-executor.js';

export interface PipelineLimits {
  maxEmbeddedImagesBytes: number;
  zipLimits: ZipLimits;
  ocrJobs: number;
}

/** Tutto ciò che serve a una pipeline per convertire un singolo file. */
export interface PipelineContext {
  inputPath: string;
  inputKind: InputKind;
  /** Directory di lavoro del file: viene cancellata a fine conversione. */
  workDir: string;
  /** Directory in cui la pipeline deve scrivere il risultato. */
  outputDir: string;
  /** Nome (sanitizzato, senza estensione) da usare per il file scaricato. */
  outputBaseName: string;
  options: ConversionOptions;
  executor: ToolExecutor;
  signal: AbortSignal;
  /** Timeout di ogni processo esterno. */
  timeoutMs: number;
  limits: PipelineLimits;
  reportProgress: (stage: string, progress: number | null) => void;
}

export interface PipelineResult {
  outputPath: string;
  /** Nome proposto per il download. */
  fileName: string;
  isArchive: boolean;
  warnings: WarningCode[];
}

export type Pipeline = (context: PipelineContext) => Promise<PipelineResult>;

export function toolOptions(context: PipelineContext) {
  return { cwd: context.workDir, signal: context.signal, timeoutMs: context.timeoutMs };
}

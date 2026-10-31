import type { ConversionErrorCode } from '@md-converter/shared';
import { AppError } from '../http/errors.js';
import { ProcessError } from '../process/process-runner.js';
import { toConversionError, type ToolExecutor, type ToolRunOptions } from './tool-executor.js';

export const OCR_LANGUAGE_PATTERN = /^[a-z]{3}(_[a-z]{3,4})?$/;

export interface OcrmypdfArgsInput {
  inputPath: string;
  outputPath: string;
  languages: readonly string[];
  /** `true` = `--force-ocr` (anche le pagine con testo), `false` = `--skip-text`. */
  force: boolean;
  /** Numero di processi Tesseract in parallelo. */
  jobs: number;
}

export function buildOcrmypdfArgs(input: OcrmypdfArgsInput): string[] {
  if (
    input.languages.length === 0 ||
    !input.languages.every((code) => OCR_LANGUAGE_PATTERN.test(code))
  ) {
    throw new AppError('OCR_LANGUAGE_NOT_AVAILABLE', 'Lingua OCR non valida.');
  }
  return [
    // `pdf` evita la conversione in PDF/A, più lenta e non necessaria per un file intermedio.
    '--output-type',
    'pdf',
    input.force ? '--force-ocr' : '--skip-text',
    '--language',
    input.languages.join('+'),
    '--jobs',
    String(input.jobs),
    '--optimize',
    '0',
    '--quiet',
    input.inputPath,
    input.outputPath,
  ];
}

/** Exit code documentati da OCRmyPDF (https://ocrmypdf.readthedocs.io/en/latest/advanced.html). */
export function mapOcrmypdfExitCode(exitCode: number | null): ConversionErrorCode {
  switch (exitCode) {
    case 3:
      return 'DEPENDENCY_MISSING';
    case 8:
      return 'PDF_ENCRYPTED';
    default:
      return 'CONVERSION_FAILED';
  }
}

export async function runOcrmypdf(
  executor: ToolExecutor,
  input: OcrmypdfArgsInput,
  options: ToolRunOptions,
): Promise<void> {
  try {
    await executor('ocrmypdf', buildOcrmypdfArgs(input), options);
  } catch (error) {
    if (error instanceof ProcessError && error.kind === 'exit-code') {
      const code = mapOcrmypdfExitCode(error.result?.exitCode ?? null);
      throw new AppError(
        code,
        code === 'CONVERSION_FAILED' ? "L'OCR non è riuscito su questo PDF." : undefined,
      );
    }
    throw toConversionError(error, 'ocrmypdf');
  }
}

export function parseOcrmypdfVersion(output: string): string | null {
  return /(\d+\.\d+(?:\.\d+)*)/.exec(output)?.[1] ?? null;
}

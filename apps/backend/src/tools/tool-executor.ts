import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { ToolId } from '@md-converter/shared';
import { AppError } from '../http/errors.js';
import { buildChildEnv } from '../process/child-env.js';
import { ProcessError, runProcess, type ProcessResult } from '../process/process-runner.js';

export interface ToolRunOptions {
  /** Directory di lavoro del file in conversione. */
  cwd: string;
  signal: AbortSignal;
  timeoutMs: number;
  successExitCodes?: readonly number[];
}

/**
 * Funzione che esegue uno strumento esterno. Le pipeline ricevono un `ToolExecutor` invece di
 * chiamare direttamente `runProcess`: nei test lo si sostituisce con una versione finta.
 */
export type ToolExecutor = (
  tool: ToolId,
  args: readonly string[],
  options: ToolRunOptions,
) => Promise<ProcessResult>;

export class CancelledError extends Error {
  constructor() {
    super('Conversione annullata');
    this.name = 'CancelledError';
  }
}

export function createToolExecutor(resolvePath: (tool: ToolId) => string | null): ToolExecutor {
  return async (tool, args, options) => {
    const command = resolvePath(tool);
    if (!command) {
      throw new AppError(
        'DEPENDENCY_MISSING',
        `Strumento non disponibile: ${tool}. Controlla il pannello Diagnostica.`,
      );
    }
    await mkdir(path.join(options.cwd, 'tmp'), { recursive: true });
    return runProcess({
      command,
      args,
      cwd: options.cwd,
      env: buildChildEnv(options.cwd),
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      successExitCodes: options.successExitCodes,
    });
  };
}

/** Traduce un errore di processo in un errore comprensibile per l'utente. */
export function toConversionError(error: unknown, tool: ToolId): Error {
  if (!(error instanceof ProcessError))
    return error instanceof Error ? error : new Error(String(error));
  switch (error.kind) {
    case 'cancelled':
      return new CancelledError();
    case 'timeout':
      return new AppError('CONVERSION_TIMEOUT');
    case 'spawn-failed':
      return new AppError('DEPENDENCY_MISSING', `Impossibile avviare ${tool}.`);
    case 'exit-code':
      return new AppError(
        'CONVERSION_FAILED',
        `${tool} ha terminato con un errore. Il file potrebbe essere danneggiato o non supportato.`,
      );
  }
}

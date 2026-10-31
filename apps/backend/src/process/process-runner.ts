import { execFile, spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

export interface RunProcessOptions {
  command: string;
  args: readonly string[];
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  /** Byte massimi conservati di stdout e di stderr (ne teniamo la parte finale). */
  maxCapturedBytes?: number | undefined;
  /** Exit code considerati successo. Predefinito: solo 0. */
  successExitCodes?: readonly number[] | undefined;
}

export interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export type ProcessFailureKind = 'spawn-failed' | 'timeout' | 'cancelled' | 'exit-code';

/** Errore di un processo esterno. `stderr` serve solo per diagnosi interne: non va mostrato all'utente. */
export class ProcessError extends Error {
  readonly kind: ProcessFailureKind;
  readonly result: ProcessResult | undefined;

  constructor(kind: ProcessFailureKind, message: string, result?: ProcessResult) {
    super(message);
    this.name = 'ProcessError';
    this.kind = kind;
    this.result = result;
  }
}

const DEFAULT_MAX_CAPTURED_BYTES = 64 * 1024;
const KILL_GRACE_MS = 2000;

/** Conserva solo gli ultimi `limit` byte: i messaggi d'errore sono quasi sempre alla fine. */
class TailBuffer {
  private chunks: Buffer[] = [];
  private size = 0;

  constructor(private readonly limit: number) {}

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size > this.limit && this.chunks.length > 1) {
      this.size -= this.chunks.shift()!.length;
    }
  }

  toString(): string {
    const joined = Buffer.concat(this.chunks);
    return joined.subarray(Math.max(0, joined.length - this.limit)).toString('utf8');
  }
}

/**
 * Termina il processo e tutti i suoi figli. LibreOffice e OCRmyPDF avviano sottoprocessi:
 * uccidere solo il primo lascerebbe processi orfani che continuano a consumare CPU.
 */
export function killProcessTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    const taskkill = path.join(systemRoot, 'System32', 'taskkill.exe');
    execFile(taskkill, ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {
      // Se taskkill fallisce (processo già terminato) non c'è altro da fare.
    });
    return;
  }
  const pid = child.pid;
  try {
    // PID negativo = intero gruppo di processi (il figlio è stato avviato con detached: true).
    process.kill(-pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // Gruppo già terminato.
    }
  }, KILL_GRACE_MS).unref();
}

/**
 * Esegue un programma esterno in modo sicuro:
 * - argomenti passati come array e `shell: false`, quindi nessuna interpretazione da parte di una shell;
 * - timeout e annullamento che terminano l'intero albero di processi;
 * - output catturato con un limite di dimensione.
 */
export function runProcess(options: RunProcessOptions): Promise<ProcessResult> {
  const maxCaptured = options.maxCapturedBytes ?? DEFAULT_MAX_CAPTURED_BYTES;
  const successExitCodes = options.successExitCodes ?? [0];
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new ProcessError('cancelled', "Processo annullato prima dell'avvio"));
      return;
    }

    const child = spawn(options.command, [...options.args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdout = new TailBuffer(maxCaptured);
    const stderr = new TailBuffer(maxCaptured);
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));

    let failure: ProcessFailureKind | null = null;
    const stop = (kind: ProcessFailureKind) => {
      if (failure) return;
      failure = kind;
      killProcessTree(child);
    };

    const timer = setTimeout(() => stop('timeout'), options.timeoutMs);
    const onAbort = () => stop('cancelled');
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    };

    child.on('error', (error: NodeJS.ErrnoException) => {
      cleanup();
      reject(
        new ProcessError(
          'spawn-failed',
          `Impossibile avviare il processo (${error.code ?? 'errore'})`,
        ),
      );
    });

    child.on('close', (exitCode) => {
      cleanup();
      const result: ProcessResult = {
        exitCode,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        durationMs: Date.now() - startedAt,
      };
      if (failure === 'timeout')
        reject(new ProcessError('timeout', 'Timeout del processo', result));
      else if (failure === 'cancelled')
        reject(new ProcessError('cancelled', 'Processo annullato', result));
      else if (exitCode === null || !successExitCodes.includes(exitCode)) {
        reject(
          new ProcessError(
            'exit-code',
            `Il processo è terminato con codice ${String(exitCode)}`,
            result,
          ),
        );
      } else resolve(result);
    });
  });
}

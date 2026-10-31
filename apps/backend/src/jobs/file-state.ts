import type { FileStatus } from '@md-converter/shared';

/** Transizioni ammesse tra gli stati di un file. Vedi il diagramma in docs/architecture.md. */
const ALLOWED_TRANSITIONS: Record<FileStatus, readonly FileStatus[]> = {
  validating: ['ready', 'failed', 'cancelled'],
  ready: ['queued', 'cancelled', 'failed'],
  queued: ['converting', 'cancelled', 'failed'],
  converting: ['completed', 'cancelled', 'failed'],
  completed: [],
  cancelled: [],
  failed: [],
};

export function canTransition(from: FileStatus, to: FileStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Lancia un errore di programmazione se la transizione non è prevista. */
export function assertTransition(from: FileStatus, to: FileStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Transizione di stato non valida: ${from} → ${to}`);
  }
}

/** Un file si può annullare finché non ha raggiunto uno stato finale. */
export function isCancellable(status: FileStatus): boolean {
  return canTransition(status, 'cancelled');
}

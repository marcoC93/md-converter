import { EventEmitter } from 'node:events';
import type { JobSnapshot } from '@md-converter/shared';

export type JobEvent = { type: 'job'; job: JobSnapshot } | { type: 'deleted' };
type Listener = (event: JobEvent) => void;

/** Notifica i cambi di stato di un job (usato dallo stream SSE). */
export class JobEvents {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Ogni scheda del browser aperta su un job è un ascoltatore: alziamo il limite predefinito (10).
    this.emitter.setMaxListeners(100);
  }

  subscribe(jobId: string, listener: Listener): () => void {
    this.emitter.on(jobId, listener);
    return () => this.emitter.off(jobId, listener);
  }

  publish(jobId: string, event: JobEvent): void {
    this.emitter.emit(jobId, event);
  }
}

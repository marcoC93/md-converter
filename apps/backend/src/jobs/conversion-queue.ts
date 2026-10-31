type Task = () => Promise<void>;

/**
 * Coda con concorrenza limitata: esegue al massimo `concurrency` compiti alla volta.
 * Limitare i processi paralleli evita di saturare CPU e memoria (LibreOffice e OCR sono pesanti).
 */
export class ConversionQueue {
  private readonly waiting: Task[] = [];
  private running = 0;
  private idleResolvers: Array<() => void> = [];

  constructor(private readonly concurrency: number) {
    if (concurrency < 1) throw new Error('La concorrenza deve essere almeno 1');
  }

  enqueue(task: Task): void {
    this.waiting.push(task);
    this.next();
  }

  /** Si risolve quando non ci sono compiti in esecuzione né in attesa. Utile nei test e all'arresto. */
  onIdle(): Promise<void> {
    if (this.running === 0 && this.waiting.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleResolvers.push(resolve));
  }

  private next(): void {
    while (this.running < this.concurrency && this.waiting.length > 0) {
      const task = this.waiting.shift()!;
      this.running++;
      // Gli errori vanno gestiti dentro il compito: qui li ignoriamo solo per non bloccare la coda.
      task()
        .catch(() => undefined)
        .finally(() => {
          this.running--;
          this.next();
          if (this.running === 0 && this.waiting.length === 0) {
            const resolvers = this.idleResolvers;
            this.idleResolvers = [];
            resolvers.forEach((resolve) => resolve());
          }
        });
    }
  }
}

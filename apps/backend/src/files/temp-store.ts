import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { isPathInside } from './safe-path.js';

const JOB_DIR_PATTERN = /^job-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface JobPaths {
  root: string;
  input: string;
  work: string;
  output: string;
}

/**
 * Gestisce le directory temporanee. Ogni job ha la sua: `TEMP_DIR/job-<uuid>/`.
 * Tutte le cancellazioni passano da qui e verificano di restare dentro `TEMP_DIR`.
 */
export class TempStore {
  readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
  }

  async init(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
  }

  jobPaths(jobId: string): JobPaths {
    const root = this.jobRoot(jobId);
    return {
      root,
      input: path.join(root, 'input'),
      work: path.join(root, 'work'),
      output: path.join(root, 'output'),
    };
  }

  async createJobDirs(jobId: string): Promise<JobPaths> {
    const paths = this.jobPaths(jobId);
    await mkdir(paths.input, { recursive: true });
    await mkdir(paths.work, { recursive: true });
    await mkdir(paths.output, { recursive: true });
    return paths;
  }

  async removeJobDir(jobId: string): Promise<void> {
    await this.removeInside(this.jobRoot(jobId));
  }

  /** Cancella una directory solo se è dentro la directory di un job gestito. */
  async removeInside(target: string): Promise<void> {
    const resolved = path.resolve(target);
    if (resolved === this.rootDir || !isPathInside(this.rootDir, resolved)) {
      throw new Error(
        'Rifiutata la cancellazione di un percorso esterno alla directory temporanea',
      );
    }
    const jobDirName = path.relative(this.rootDir, resolved).split(path.sep)[0] ?? '';
    if (!JOB_DIR_PATTERN.test(jobDirName)) {
      throw new Error('Rifiutata la cancellazione di una directory non appartenente a un job');
    }
    // maxRetries aiuta su Windows, dove antivirus o processi appena terminati tengono aperti i file.
    await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }

  /**
   * Rimuove le directory di job non più attive e più vecchie di `maxAgeMs`.
   * Usata all'avvio (directory orfane di un'esecuzione precedente) e periodicamente.
   */
  async removeStaleJobDirs(maxAgeMs: number, activeJobIds: ReadonlySet<string>): Promise<number> {
    const entries = await readdir(this.rootDir, { withFileTypes: true }).catch(() => []);
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || !JOB_DIR_PATTERN.test(entry.name)) continue;
      const jobId = entry.name.slice('job-'.length);
      if (activeJobIds.has(jobId)) continue;
      const fullPath = path.join(this.rootDir, entry.name);
      const info = await stat(fullPath).catch(() => null);
      if (info && Date.now() - info.mtimeMs > maxAgeMs) {
        await this.removeInside(fullPath);
        removed++;
      }
    }
    return removed;
  }

  private jobRoot(jobId: string): string {
    const dirName = `job-${jobId}`;
    if (!JOB_DIR_PATTERN.test(dirName)) {
      throw new Error('Identificatore di job non valido');
    }
    return path.join(this.rootDir, dirName);
  }
}

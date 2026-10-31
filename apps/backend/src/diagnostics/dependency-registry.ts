import { randomUUID } from 'node:crypto';
import type { DiagnosticsReport, ToolId } from '@md-converter/shared';
import type { AppConfig } from '../config.js';
import type { TempStore } from '../files/temp-store.js';
import { checkDependencies, type DependencyCheckResult } from './dependency-checker.js';

export type DependencyChecker = (workDir: string) => Promise<DependencyCheckResult>;

/**
 * Conserva l'ultimo esito della diagnostica. Il controllo viene eseguito all'avvio e
 * su richiesta (`GET /api/diagnostics?refresh=true`), non a ogni conversione.
 */
export class DependencyRegistry {
  private current: DependencyCheckResult | null = null;
  private running: Promise<DependencyCheckResult> | null = null;
  private readonly checker: DependencyChecker;

  constructor(
    private readonly tempStore: TempStore,
    config: Pick<AppConfig, 'toolPaths' | 'allowedOcrLanguages'>,
    checker?: DependencyChecker,
  ) {
    this.checker = checker ?? ((workDir) => checkDependencies(config, workDir));
  }

  async refresh(): Promise<DiagnosticsReport> {
    // Se un controllo è già in corso, si attende quello invece di avviarne un altro.
    this.running ??= this.runCheck().finally(() => {
      this.running = null;
    });
    this.current = await this.running;
    return this.current.report;
  }

  async report(): Promise<DiagnosticsReport> {
    return this.current?.report ?? this.refresh();
  }

  toolPath(tool: ToolId): string | null {
    return this.current?.paths[tool] ?? null;
  }

  isAvailable(tool: ToolId): boolean {
    return this.toolPath(tool) !== null;
  }

  ocrLanguages(): string[] {
    return this.current?.report.ocrLanguages ?? [];
  }

  private async runCheck(): Promise<DependencyCheckResult> {
    // Directory temporanea "da job" così la cancellazione passa dagli stessi controlli di sicurezza.
    const id = randomUUID();
    const paths = await this.tempStore.createJobDirs(id);
    try {
      return await this.checker(paths.work);
    } finally {
      await this.tempStore.removeJobDir(id).catch(() => undefined);
    }
  }
}

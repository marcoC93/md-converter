import { buildApp } from './app.js';
import { ConfigError, isLoopbackHost, loadConfig } from './config.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const { app, jobs, registry, tempStore } = await buildApp(config);

  // Directory rimaste da un'esecuzione precedente (es. arresto improvviso).
  const orphans = await tempStore.removeStaleJobDirs(config.jobTtlMs, jobs.activeJobIds);
  if (orphans > 0) app.log.info({ removed: orphans }, 'removed orphan temporary directories');

  const report = await registry.refresh();
  for (const tool of report.tools) {
    app.log.info(
      { tool: tool.id, available: tool.available, version: tool.version, problem: tool.problem },
      'dependency check',
    );
  }

  const cleanupTimer = setInterval(() => {
    void (async () => {
      await jobs.removeExpiredJobs();
      await tempStore.removeStaleJobDirs(config.jobTtlMs, jobs.activeJobIds);
    })().catch((error: unknown) => app.log.error({ err: error }, 'periodic cleanup failed'));
  }, config.cleanupIntervalMs);
  cleanupTimer.unref();

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    app.log.info({ signal }, 'shutting down');
    clearInterval(cleanupTimer);
    // app.close() esegue l'hook onClose, che annulla i job e cancella i file temporanei.
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
  if (!isLoopbackHost(config.host)) {
    app.log.warn(
      { host: config.host },
      'ATTENZIONE: il servizio è raggiungibile da altri computer della rete',
    );
  }
  app.log.info(
    `Convertitore pronto su http://${config.host.includes(':') ? `[${config.host}]` : config.host}:${config.port}`,
  );
}

void main();

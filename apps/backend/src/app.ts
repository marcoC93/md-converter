import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import type { ApiErrorBody } from '@md-converter/shared';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import { DependencyRegistry, type DependencyChecker } from './diagnostics/dependency-registry.js';
import { TempStore } from './files/temp-store.js';
import { registerErrorHandler } from './http/error-handler.js';
import { AppError } from './http/errors.js';
import { registerRequestGuard } from './http/request-guard.js';
import { registerSecurityHeaders } from './http/security-headers.js';
import { JobEvents } from './jobs/job-events.js';
import { JobService } from './jobs/job-service.js';
import { registerDownloadRoutes } from './routes/download-routes.js';
import { registerEventRoutes } from './routes/event-routes.js';
import { registerJobRoutes } from './routes/job-routes.js';
import { registerSystemRoutes } from './routes/system-routes.js';
import { createToolExecutor, type ToolExecutor } from './tools/tool-executor.js';

export interface AppOverrides {
  /** Sostituisce l'esecuzione reale degli strumenti (test). */
  executor?: ToolExecutor;
  /** Sostituisce il controllo reale delle dipendenze (test). */
  dependencyChecker?: DependencyChecker;
}

export interface Application {
  app: FastifyInstance;
  jobs: JobService;
  registry: DependencyRegistry;
  tempStore: TempStore;
}

const JSON_BODY_LIMIT = 64 * 1024;

function registerFrontend(app: FastifyInstance, distDir: string): void {
  const indexFile = path.join(distDir, 'index.html');
  const hasFrontend = existsSync(indexFile);
  if (hasFrontend) {
    void app.register(fastifyStatic, { root: distDir, prefix: '/', index: ['index.html'] });
  }
  app.setNotFoundHandler((request, reply) => {
    if (hasFrontend && request.method === 'GET' && !request.url.startsWith('/api/')) {
      return reply.type('text/html; charset=utf-8').sendFile('index.html');
    }
    const body: ApiErrorBody = { error: new AppError('NOT_FOUND').toInfo(request.id) };
    return reply.status(404).send(body);
  });
}

/** Costruisce l'applicazione completa senza metterla in ascolto (così è testabile con `inject`). */
export async function buildApp(
  config: AppConfig,
  overrides: AppOverrides = {},
): Promise<Application> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers.cookie', 'req.headers.authorization'],
    },
    // Ogni richiesta riceve un ID casuale: non ci fidiamo di eventuali ID inviati dal client.
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: JSON_BODY_LIMIT,
    // Con il valore predefinito di Fastify (72 s) alcuni client che riusano una connessione
    // inattiva restavano bloccati ~30 s (vedi docs/implementation-log.md). 5 s è il default di Node.
    keepAliveTimeout: 5000,
  });

  // Log minimale: metodo, rotta (senza parametri reali), stato, durata. Mai nomi di file o contenuti.
  app.addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        method: request.method,
        route: request.routeOptions.url ?? 'not-found',
        statusCode: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      },
      'request completed',
    );
  });

  registerSecurityHeaders(app);
  registerRequestGuard(app, config.allowedHosts);
  registerErrorHandler(app);

  await app.register(fastifyMultipart, {
    limits: { fileSize: config.maxFileSizeBytes, files: 1, fields: 5, parts: 6, headerPairs: 100 },
  });

  const tempStore = new TempStore(config.tempDir);
  await tempStore.init();
  const registry = new DependencyRegistry(tempStore, config, overrides.dependencyChecker);
  const events = new JobEvents();
  const executor = overrides.executor ?? createToolExecutor((tool) => registry.toolPath(tool));
  const zipLimits = {
    maxEntries: 5000,
    maxTotalUncompressedBytes: config.maxFileSizeBytes * 4,
    maxCompressionRatio: 200,
  };

  const jobs = new JobService(
    tempStore,
    events,
    {
      executor,
      isToolAvailable: (tool) => registry.isAvailable(tool),
      installedOcrLanguages: () => registry.ocrLanguages(),
      timeoutMs: config.conversionTimeoutMs,
      maxOutputSizeBytes: config.maxOutputSizeBytes,
      limits: {
        maxEmbeddedImagesBytes: config.maxEmbeddedImagesBytes,
        zipLimits,
        ocrJobs: config.ocrJobs,
      },
    },
    {
      maxFilesPerJob: config.maxFilesPerJob,
      maxFileSizeBytes: config.maxFileSizeBytes,
      maxTotalSizeBytes: config.maxTotalSizeBytes,
      maxActiveJobs: config.maxActiveJobs,
      maxConcurrentJobs: config.maxConcurrentJobs,
      jobTtlMs: config.jobTtlMs,
      cleanupAfterDownloadMs: config.cleanupAfterDownloadMs,
      zipLimits,
    },
    app.log,
  );

  registerSystemRoutes(app, config, registry);
  registerJobRoutes(app, config, jobs);
  registerEventRoutes(app, jobs, events);
  registerDownloadRoutes(app, jobs);
  registerFrontend(app, config.frontendDistDir);

  app.addHook('onClose', async () => {
    await jobs.shutdown();
  });

  return { app, jobs, registry, tempStore };
}

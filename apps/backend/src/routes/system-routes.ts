import type { PublicConfig } from '@md-converter/shared';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import type { DependencyRegistry } from '../diagnostics/dependency-registry.js';
import { diagnosticsQuerySchema } from './schemas.js';

export function registerSystemRoutes(
  app: FastifyInstance,
  config: AppConfig,
  registry: DependencyRegistry,
): void {
  app.get('/api/health', async () => ({ status: 'ok' }));

  app.get('/api/config', async (): Promise<PublicConfig> => ({
    maxFiles: config.maxFilesPerJob,
    maxFileSizeBytes: config.maxFileSizeBytes,
    maxTotalSizeBytes: config.maxTotalSizeBytes,
    maxEmbeddedImagesBytes: config.maxEmbeddedImagesBytes,
    allowedOcrLanguages: config.allowedOcrLanguages,
    conversionTimeoutSeconds: Math.round(config.conversionTimeoutMs / 1000),
  }));

  app.get('/api/diagnostics', async (request) => {
    const query = diagnosticsQuerySchema.parse(request.query);
    return query.refresh === 'true' ? registry.refresh() : registry.report();
  });
}

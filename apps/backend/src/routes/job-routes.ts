import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import { AppError } from '../http/errors.js';
import type { JobService } from '../jobs/job-service.js';
import { conversionOptionsSchema, fileParamsSchema, jobParamsSchema } from './schemas.js';

export function registerJobRoutes(app: FastifyInstance, config: AppConfig, jobs: JobService): void {
  const optionsSchema = conversionOptionsSchema(config.allowedOcrLanguages);

  app.post('/api/jobs', async (_request, reply) => {
    return reply.status(201).send(await jobs.createJob());
  });

  app.get('/api/jobs/:jobId', async (request) => {
    const { jobId } = jobParamsSchema.parse(request.params);
    return jobs.getJob(jobId);
  });

  app.delete('/api/jobs/:jobId', async (request, reply) => {
    const { jobId } = jobParamsSchema.parse(request.params);
    await jobs.deleteJob(jobId);
    return reply.status(204).send();
  });

  app.post('/api/jobs/:jobId/files', async (request, reply) => {
    const { jobId } = jobParamsSchema.parse(request.params);
    if (!request.isMultipart())
      throw new AppError('UNSUPPORTED_FILE_TYPE', 'Usa una richiesta multipart/form-data.');
    const part = await request.file();
    if (!part || part.fieldname !== 'file') {
      part?.file.resume();
      throw new AppError('MISSING_FILE');
    }
    const file = await jobs.addFile(jobId, {
      fileName: part.filename,
      mimeType: part.mimetype,
      stream: part.file,
    });
    return reply.status(201).send(file);
  });

  app.delete('/api/jobs/:jobId/files/:fileId', async (request, reply) => {
    const { jobId, fileId } = fileParamsSchema.parse(request.params);
    await jobs.removeFile(jobId, fileId);
    return reply.status(204).send();
  });

  app.post('/api/jobs/:jobId/start', async (request, reply) => {
    const { jobId } = jobParamsSchema.parse(request.params);
    const options = optionsSchema.parse(request.body);
    return reply.status(202).send(jobs.start(jobId, options));
  });

  app.post('/api/jobs/:jobId/cancel', async (request, reply) => {
    const { jobId } = jobParamsSchema.parse(request.params);
    return reply.status(202).send(jobs.cancelJob(jobId));
  });

  app.post('/api/jobs/:jobId/files/:fileId/cancel', async (request, reply) => {
    const { jobId, fileId } = fileParamsSchema.parse(request.params);
    return reply.status(202).send(jobs.cancelFile(jobId, fileId));
  });
}

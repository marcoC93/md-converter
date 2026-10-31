import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { contentDisposition } from '../files/sanitize-filename.js';
import type { JobService } from '../jobs/job-service.js';
import { fileParamsSchema, jobParamsSchema } from './schemas.js';

const CONTENT_TYPES: Record<string, string> = {
  '.md': 'text/markdown; charset=utf-8',
  '.zip': 'application/zip',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function contentTypeFor(fileName: string): string {
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

export function registerDownloadRoutes(app: FastifyInstance, jobs: JobService): void {
  app.get('/api/jobs/:jobId/files/:fileId/download', async (request, reply) => {
    const { jobId, fileId } = fileParamsSchema.parse(request.params);
    const download = jobs.getDownload(jobId, fileId);
    // Il segnale "finish" arriva solo se il browser ha ricevuto tutto il file.
    reply.raw.once('finish', () => jobs.markDownloaded(jobId, [fileId]));
    return reply
      .header('Content-Type', contentTypeFor(download.fileName))
      .header('Content-Length', String(download.sizeBytes))
      .header('Content-Disposition', contentDisposition(download.fileName))
      .send(createReadStream(download.filePath));
  });

  app.get('/api/jobs/:jobId/archive', async (request, reply) => {
    const { jobId } = jobParamsSchema.parse(request.params);
    const archive = jobs.createArchive(jobId);
    reply.raw.once('finish', () => jobs.markDownloaded(jobId, archive.fileIds));
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', contentDisposition(archive.fileName))
      .send(archive.stream);
  });
}

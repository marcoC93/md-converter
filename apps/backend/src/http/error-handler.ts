import type { ApiErrorBody } from '@md-converter/shared';
import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError, isAppError } from './errors.js';

/** Converte gli errori interni di Fastify e dei plugin in errori dell'applicazione. */
function toAppError(error: FastifyError | Error): AppError | null {
  if (isAppError(error)) return error;
  if (error instanceof ZodError) {
    const fields = [...new Set(error.issues.map((issue) => issue.path.join('.') || 'body'))];
    return new AppError('VALIDATION_ERROR', `Campi non validi: ${fields.join(', ')}`);
  }

  const fastifyError = error as FastifyError;
  switch (fastifyError.code) {
    case 'FST_REQ_FILE_TOO_LARGE':
      return new AppError('FILE_TOO_LARGE');
    case 'FST_FILES_LIMIT':
    case 'FST_PARTS_LIMIT':
    case 'FST_FIELDS_LIMIT':
      return new AppError('VALIDATION_ERROR', 'Invia un solo file per richiesta.');
    case 'FST_INVALID_MULTIPART_CONTENT_TYPE':
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
      return new AppError('UNSUPPORTED_FILE_TYPE', 'Content-Type della richiesta non supportato.');
    case 'FST_ERR_CTP_BODY_TOO_LARGE':
      return new AppError('FILE_TOO_LARGE');
    default:
      break;
  }
  if (fastifyError.validation || (fastifyError.statusCode && fastifyError.statusCode < 500)) {
    return new AppError('VALIDATION_ERROR');
  }
  return null;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    const appError = toAppError(error);
    if (appError) {
      request.log.info({ code: appError.code, statusCode: appError.statusCode }, 'request failed');
      const body: ApiErrorBody = { error: appError.toInfo(request.id) };
      return reply.status(appError.statusCode).send(body);
    }
    // Errore imprevisto: lo stack trace resta nei log del server, al browser va un messaggio generico.
    request.log.error({ err: error }, 'unexpected error');
    const body: ApiErrorBody = { error: new AppError('INTERNAL_ERROR').toInfo(request.id) };
    return reply.status(500).send(body);
  });
}

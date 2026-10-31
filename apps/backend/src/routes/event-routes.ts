import type { FastifyInstance } from 'fastify';
import type { JobEvent, JobEvents } from '../jobs/job-events.js';
import type { JobService } from '../jobs/job-service.js';
import { jobParamsSchema } from './schemas.js';

const HEARTBEAT_MS = 15_000;

/**
 * Server-Sent Events: la risposta resta aperta e il server vi scrive un messaggio a ogni
 * cambio di stato. Formato di un messaggio:
 *   event: job
 *   data: {"id":"...","files":[...]}
 */
export function registerEventRoutes(
  app: FastifyInstance,
  jobs: JobService,
  events: JobEvents,
): void {
  app.get('/api/jobs/:jobId/events', async (request, reply) => {
    const { jobId } = jobParamsSchema.parse(request.params);
    const initial = jobs.getJob(jobId);

    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string>),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (event: JobEvent) => {
      if (event.type === 'job')
        response.write(`event: job\ndata: ${JSON.stringify(event.job)}\n\n`);
      else response.write('event: deleted\ndata: {}\n\n');
    };
    send({ type: 'job', job: initial });

    const unsubscribe = events.subscribe(jobId, (event) => {
      send(event);
      if (event.type === 'deleted') close();
    });
    // Un commento periodico mantiene viva la connessione attraverso proxy e timeout.
    const heartbeat = setInterval(() => response.write(': ping\n\n'), HEARTBEAT_MS);
    heartbeat.unref();

    function close() {
      clearInterval(heartbeat);
      unsubscribe();
      response.end();
    }
    request.raw.on('close', close);
  });
}

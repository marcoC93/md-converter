import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { JobSnapshot } from '@md-converter/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type Application } from '../../src/app.js';
import {
  createFakeExecutor,
  createTempDir,
  fakeDependencyChecker,
  removeDir,
  testConfig,
} from '../helpers.js';

/** Legge uno stream SSE e restituisce gli eventi ricevuti man mano. */
function openEventStream(url: string) {
  const events: Array<{ event: string; data: string }> = [];
  let buffer = '';
  let ended = false;
  const request = http.get(url, (response) => {
    response.setEncoding('utf8');
    response.on('data', (chunk: string) => {
      buffer += chunk;
      let separator;
      while ((separator = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const event = /^event: (.*)$/m.exec(raw)?.[1];
        const data = /^data: (.*)$/m.exec(raw)?.[1];
        if (event && data) events.push({ event, data });
      }
    });
    response.on('end', () => {
      ended = true;
    });
  });
  return { events, close: () => request.destroy(), isEnded: () => ended };
}

async function waitFor(condition: () => boolean, timeoutMs = 5000) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('timeout');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('Server-Sent Events', () => {
  let tempDir: string;
  let application: Application;
  let baseUrl: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    application = await buildApp(testConfig(tempDir), {
      executor: createFakeExecutor().executor,
      dependencyChecker: fakeDependencyChecker(),
    });
    await application.app.listen({ host: '127.0.0.1', port: 0 });
    baseUrl = `http://127.0.0.1:${(application.app.server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await application.app.close();
    await removeDir(tempDir);
  });

  it('invia lo stato iniziale, gli aggiornamenti e la chiusura quando il job viene eliminato', async () => {
    const job = (await (
      await fetch(`${baseUrl}/api/jobs`, { method: 'POST' })
    ).json()) as JobSnapshot;
    const stream = openEventStream(`${baseUrl}/api/jobs/${job.id}/events`);
    await waitFor(() => stream.events.length >= 1);
    expect(stream.events[0]?.event).toBe('job');
    expect(JSON.parse(stream.events[0]!.data).id).toBe(job.id);

    const form = new FormData();
    form.append('file', new Blob(['# Titolo']), 'nota.md');
    await fetch(`${baseUrl}/api/jobs/${job.id}/files`, { method: 'POST', body: form });
    await waitFor(() =>
      stream.events.some(
        (event) => event.event === 'job' && JSON.parse(event.data).files.length === 1,
      ),
    );

    await fetch(`${baseUrl}/api/jobs/${job.id}`, { method: 'DELETE' });
    await waitFor(() => stream.events.some((event) => event.event === 'deleted'));
    await waitFor(() => stream.isEnded());
    stream.close();
  });

  it('restituisce 404 per un job inesistente', async () => {
    const response = await fetch(`${baseUrl}/api/jobs/6f1c1c7e-8a7a-4d55-9f4a-0c1b2c3d4e5f/events`);
    expect(response.status).toBe(404);
  });

  it('ascolta solo su loopback', () => {
    const address = application.app.server.address() as AddressInfo;
    expect(address.address).toBe('127.0.0.1');
  });
});

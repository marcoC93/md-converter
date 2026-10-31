import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { JobSnapshot } from '@md-converter/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type Application } from '../../src/app.js';
import {
  createFakeExecutor,
  createTempDir,
  fakeDependencyChecker,
  multipartPayload,
  readFixture,
  removeDir,
  testConfig,
} from '../helpers.js';

const HOST = { host: '127.0.0.1:8080' };
const START_OPTIONS = {
  outputFormat: 'docx',
  mode: 'simple',
  imageMode: 'separate',
  ocr: { enabled: false, languages: ['ita'], force: false },
};

describe('API', () => {
  let tempDir: string;
  let application: Application;
  let app: FastifyInstance;

  async function setup(env: Record<string, string> = {}) {
    application = await buildApp(testConfig(tempDir, env), {
      executor: createFakeExecutor().executor,
      dependencyChecker: fakeDependencyChecker(),
    });
    app = application.app;
    await application.registry.refresh();
  }

  async function createJob(): Promise<JobSnapshot> {
    const response = await app.inject({ method: 'POST', url: '/api/jobs', headers: HOST });
    expect(response.statusCode).toBe(201);
    return response.json<JobSnapshot>();
  }

  async function upload(jobId: string, fileName: string, content: Buffer | string, mime?: string) {
    const { payload, headers } = multipartPayload(fileName, content, mime);
    return app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/files`,
      payload,
      headers: { ...headers, ...HOST },
    });
  }

  beforeEach(async () => {
    tempDir = await createTempDir();
  });
  afterEach(async () => {
    await app.close();
    await removeDir(tempDir);
  });

  describe('servizio', () => {
    beforeEach(() => setup());

    it('risponde allo health check con header di sicurezza e ID di correlazione', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/health', headers: HOST });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
      expect(response.headers['content-security-policy']).toContain("default-src 'self'");
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('espone la configurazione pubblica e la diagnostica', async () => {
      const config = await app.inject({ method: 'GET', url: '/api/config', headers: HOST });
      expect(config.json()).toMatchObject({ maxFiles: 20, allowedOcrLanguages: ['ita', 'eng'] });
      const diagnostics = await app.inject({
        method: 'GET',
        url: '/api/diagnostics?refresh=true',
        headers: HOST,
      });
      expect(diagnostics.statusCode).toBe(200);
      expect(diagnostics.json().tools).toHaveLength(4);
    });

    it('rifiuta Host estranei (DNS rebinding)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { host: 'attacker.example:8080' },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('FORBIDDEN_REQUEST');
    });

    it('rifiuta richieste di modifica da altre origini (CSRF)', async () => {
      const crossOrigin = await app.inject({
        method: 'POST',
        url: '/api/jobs',
        headers: { ...HOST, origin: 'https://evil.example' },
      });
      expect(crossOrigin.statusCode).toBe(403);
      const crossSite = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { ...HOST, 'sec-fetch-site': 'cross-site' },
      });
      expect(crossSite.statusCode).toBe(403);
      const sameOrigin = await app.inject({
        method: 'POST',
        url: '/api/jobs',
        headers: { ...HOST, origin: 'http://127.0.0.1:8080' },
      });
      expect(sameOrigin.statusCode).toBe(201);
    });

    it('usa un formato di errore uniforme senza stack trace', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/jobs/not-a-uuid',
        headers: HOST,
      });
      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: expect.any(String),
        correlationId: response.headers['x-correlation-id'],
      });
      expect(JSON.stringify(body)).not.toMatch(/at .*\.ts|stack/i);
    });

    it('rifiuta ID con path traversal', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/jobs/..%2F..%2Fetc',
        headers: HOST,
      });
      expect(response.statusCode).toBe(400);
    });

    it('restituisce 404 per job inesistenti e rotte sconosciute', async () => {
      const missing = await app.inject({
        method: 'GET',
        url: '/api/jobs/6f1c1c7e-8a7a-4d55-9f4a-0c1b2c3d4e5f',
        headers: HOST,
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.code).toBe('NOT_FOUND');
      const unknown = await app.inject({ method: 'GET', url: '/api/nope', headers: HOST });
      expect(unknown.statusCode).toBe(404);
    });
  });

  describe('upload', () => {
    beforeEach(() =>
      setup({ MAX_FILE_SIZE_MB: '1', MAX_TOTAL_SIZE_MB: '1', MAX_FILES_PER_JOB: '3' }),
    );

    it('accetta un file valido e non espone percorsi', async () => {
      const job = await createJob();
      const response = await upload(
        job.id,
        'relazione.pdf',
        await readFixture('text.pdf'),
        'application/pdf',
      );
      expect(response.statusCode).toBe(201);
      const file = response.json();
      expect(file).toMatchObject({
        status: 'ready',
        inputKind: 'pdf',
        displayName: 'relazione.pdf',
        pdfAnalysis: { pageCount: 3, ocrSuggested: false },
      });
      const snapshot = JSON.stringify(
        (await app.inject({ method: 'GET', url: `/api/jobs/${job.id}`, headers: HOST })).json(),
      );
      expect(snapshot).not.toContain(tempDir);
      expect(snapshot).not.toMatch(/[A-Za-z]:\\|\/tmp\//);
    });

    it("suggerisce l'OCR per un PDF scansionato", async () => {
      const job = await createJob();
      const response = await upload(job.id, 'scan.pdf', await readFixture('scanned.pdf'));
      expect(response.json().pdfAnalysis.ocrSuggested).toBe(true);
    });

    it('sanitizza i nomi malevoli', async () => {
      const job = await createJob();
      const response = await upload(job.id, '..\\..\\Windows\\evil<script>.md', '# Titolo\n');
      expect(response.statusCode).toBe(201);
      expect(response.json().displayName).toBe('evil_script_.md');
      const inputDir = application.tempStore.jobPaths(job.id).input;
      const stored = await readdir(inputDir);
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatch(/^[0-9a-f-]{36}\.md$/);
    });

    it('rifiuta estensioni non supportate', async () => {
      const job = await createJob();
      const response = await upload(job.id, 'virus.exe', 'MZ');
      expect(response.statusCode).toBe(415);
      expect(response.json().error.code).toBe('UNSUPPORTED_FILE_TYPE');
    });

    it('rifiuta un MIME incoerente', async () => {
      const job = await createJob();
      const response = await upload(job.id, 'doc.pdf', await readFixture('text.pdf'), 'text/html');
      expect(response.statusCode).toBe(415);
    });

    it("rifiuta contenuti che non corrispondono all'estensione e non li conserva", async () => {
      const job = await createJob();
      const response = await upload(
        job.id,
        'fake.pdf',
        await readFixture('fake.pdf'),
        'application/pdf',
      );
      expect(response.statusCode).toBe(415);
      expect(response.json().error.code).toBe('INVALID_FILE_CONTENT');
      expect(await readdir(application.tempStore.jobPaths(job.id).input)).toEqual([]);
      expect(
        (await app.inject({ method: 'GET', url: `/api/jobs/${job.id}`, headers: HOST })).json()
          .files,
      ).toEqual([]);
    });

    it('interrompe gli upload troppo grandi', async () => {
      const job = await createJob();
      const response = await upload(job.id, 'grande.md', 'a'.repeat(1024 * 1024 + 10));
      expect(response.statusCode).toBe(413);
      expect(response.json().error.code).toBe('FILE_TOO_LARGE');
      expect(await readdir(application.tempStore.jobPaths(job.id).input)).toEqual([]);
    });

    it('applica il limite complessivo', async () => {
      const job = await createJob();
      expect((await upload(job.id, 'a.md', 'a'.repeat(700 * 1024))).statusCode).toBe(201);
      const second = await upload(job.id, 'b.md', 'b'.repeat(700 * 1024));
      expect(second.statusCode).toBe(413);
      expect(second.json().error.code).toBe('TOTAL_SIZE_EXCEEDED');
    });

    it('applica il limite sul numero di file', async () => {
      const job = await createJob();
      for (const name of ['1.md', '2.md', '3.md'])
        expect((await upload(job.id, name, '# x')).statusCode).toBe(201);
      const fourth = await upload(job.id, '4.md', '# x');
      expect(fourth.statusCode).toBe(400);
      expect(fourth.json().error.code).toBe('TOO_MANY_FILES');
    });

    it('richiede il campo "file"', async () => {
      const job = await createJob();
      const { payload, headers } = multipartPayload('a.md', '# x', 'text/markdown', 'altro');
      const response = await app.inject({
        method: 'POST',
        url: `/api/jobs/${job.id}/files`,
        payload,
        headers: { ...headers, ...HOST },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('MISSING_FILE');
    });

    it('rifiuta un pacchetto ZIP con percorsi pericolosi', async () => {
      const { rawZipWithEntryName } = await import('../helpers.js');
      const job = await createJob();
      const response = await upload(
        job.id,
        'pacchetto.zip',
        rawZipWithEntryName('../../evil.md', '# x'),
      );
      expect(response.statusCode).toBe(415);
      expect(response.json().error.code).toBe('UNSAFE_ARCHIVE');
    });
  });

  describe('ciclo di vita del job', () => {
    beforeEach(() => setup());

    it('converte, scarica il singolo risultato e lo ZIP complessivo', async () => {
      const job = await createJob();
      const file = (await upload(job.id, 'note.md', '# Note\n')).json();
      const start = await app.inject({
        method: 'POST',
        url: `/api/jobs/${job.id}/start`,
        headers: HOST,
        payload: START_OPTIONS,
      });
      expect(start.statusCode).toBe(202);
      await application.jobs.waitForIdle();

      const status = (
        await app.inject({ method: 'GET', url: `/api/jobs/${job.id}`, headers: HOST })
      ).json<JobSnapshot>();
      expect(status.files[0]).toMatchObject({
        status: 'completed',
        result: { fileName: 'note.docx', isArchive: false },
      });

      const download = await app.inject({
        method: 'GET',
        url: `/api/jobs/${job.id}/files/${file.id}/download`,
        headers: HOST,
      });
      expect(download.statusCode).toBe(200);
      expect(download.headers['content-disposition']).toContain('note.docx');
      expect(download.headers['content-type']).toContain('wordprocessingml');

      const archive = await app.inject({
        method: 'GET',
        url: `/api/jobs/${job.id}/archive`,
        headers: HOST,
      });
      expect(archive.statusCode).toBe(200);
      expect(archive.headers['content-type']).toBe('application/zip');
      expect(archive.headers['content-disposition']).toMatch(
        /conversioni-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.zip/,
      );
      expect(archive.rawPayload.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
      expect(archive.rawPayload.includes(Buffer.from('report.json'))).toBe(true);
    });

    it('valida le opzioni di avvio', async () => {
      const job = await createJob();
      await upload(job.id, 'a.md', '# a');
      const invalid = [
        { ...START_OPTIONS, outputFormat: 'odt' },
        { ...START_OPTIONS, ocr: { enabled: true, languages: ['klingon'], force: false } },
        { ...START_OPTIONS, extra: true },
        {},
      ];
      for (const payload of invalid) {
        const response = await app.inject({
          method: 'POST',
          url: `/api/jobs/${job.id}/start`,
          headers: HOST,
          payload,
        });
        expect(response.statusCode).toBe(400);
      }
    });

    it("non avvia due volte e non accetta upload dopo l'avvio", async () => {
      const job = await createJob();
      await upload(job.id, 'a.md', '# a');
      await app.inject({
        method: 'POST',
        url: `/api/jobs/${job.id}/start`,
        headers: HOST,
        payload: START_OPTIONS,
      });
      const again = await app.inject({
        method: 'POST',
        url: `/api/jobs/${job.id}/start`,
        headers: HOST,
        payload: START_OPTIONS,
      });
      expect(again.statusCode).toBe(409);
      expect((await upload(job.id, 'b.md', '# b')).statusCode).toBe(409);
    });

    it('non avvia un job senza file', async () => {
      const job = await createJob();
      const response = await app.inject({
        method: 'POST',
        url: `/api/jobs/${job.id}/start`,
        headers: HOST,
        payload: START_OPTIONS,
      });
      expect(response.statusCode).toBe(409);
    });

    it('segnala per file le conversioni verso lo stesso formato', async () => {
      const job = await createJob();
      await upload(job.id, 'a.pdf', await readFixture('text.pdf'));
      await app.inject({
        method: 'POST',
        url: `/api/jobs/${job.id}/start`,
        headers: HOST,
        payload: { ...START_OPTIONS, outputFormat: 'pdf' },
      });
      await application.jobs.waitForIdle();
      const status = (
        await app.inject({ method: 'GET', url: `/api/jobs/${job.id}`, headers: HOST })
      ).json<JobSnapshot>();
      expect(status.files[0]).toMatchObject({
        status: 'failed',
        error: { code: 'UNSUPPORTED_CONVERSION' },
      });
    });

    it('il download di un risultato non pronto restituisce 409', async () => {
      const job = await createJob();
      const file = (await upload(job.id, 'a.md', '# a')).json();
      const response = await app.inject({
        method: 'GET',
        url: `/api/jobs/${job.id}/files/${file.id}/download`,
        headers: HOST,
      });
      expect(response.statusCode).toBe(409);
      const archive = await app.inject({
        method: 'GET',
        url: `/api/jobs/${job.id}/archive`,
        headers: HOST,
      });
      expect(archive.statusCode).toBe(409);
    });

    it('rimuove un file dalla coda', async () => {
      const job = await createJob();
      const file = (await upload(job.id, 'a.md', '# a')).json();
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/jobs/${job.id}/files/${file.id}`,
        headers: HOST,
      });
      expect(response.statusCode).toBe(204);
      expect(
        (await app.inject({ method: 'GET', url: `/api/jobs/${job.id}`, headers: HOST })).json()
          .files,
      ).toEqual([]);
      expect(await readdir(application.tempStore.jobPaths(job.id).input)).toEqual([]);
    });

    it('elimina il job e i suoi file temporanei', async () => {
      const job = await createJob();
      await upload(job.id, 'a.md', '# a');
      const root = application.tempStore.jobPaths(job.id).root;
      expect(existsSync(root)).toBe(true);
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/jobs/${job.id}`,
        headers: HOST,
      });
      expect(response.statusCode).toBe(204);
      expect(existsSync(root)).toBe(false);
      expect(
        (await app.inject({ method: 'GET', url: `/api/jobs/${job.id}`, headers: HOST })).statusCode,
      ).toBe(404);
    });

    it('limita il numero di job attivi', async () => {
      await app.close();
      await setup({ MAX_ACTIVE_JOBS: '2' });
      await createJob();
      await createJob();
      const third = await app.inject({ method: 'POST', url: '/api/jobs', headers: HOST });
      expect(third.statusCode).toBe(503);
      expect(third.json().error.code).toBe('SERVICE_BUSY');
    });

    it("all'arresto cancella tutte le directory dei job", async () => {
      const job = await createJob();
      await upload(job.id, 'a.md', '# a');
      await app.close();
      expect(existsSync(path.join(application.tempStore.rootDir, `job-${job.id}`))).toBe(false);
      await setup();
    });
  });
});

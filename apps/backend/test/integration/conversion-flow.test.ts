import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ConversionOptions, JobSnapshot, ToolId } from '@md-converter/shared';
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
  type FakeBehavior,
} from '../helpers.js';

const HOST = { host: '127.0.0.1:8080' };
const baseOptions: ConversionOptions = {
  outputFormat: 'docx',
  mode: 'simple',
  imageMode: 'separate',
  ocr: { enabled: false, languages: ['ita'], force: false },
};

interface SetupOptions {
  env?: Record<string, string>;
  behavior?: Partial<Record<ToolId, FakeBehavior>>;
  available?: ToolId[];
  ocrLanguages?: string[];
}

describe('flusso di conversione (strumenti simulati)', () => {
  let tempDir: string;
  let application: Application;
  let calls: ReturnType<typeof createFakeExecutor>['calls'];

  async function setup(options: SetupOptions = {}) {
    const fake = createFakeExecutor(options.behavior);
    calls = fake.calls;
    application = await buildApp(testConfig(tempDir, options.env), {
      executor: fake.executor,
      dependencyChecker: fakeDependencyChecker(options.available, options.ocrLanguages),
    });
    await application.registry.refresh();
  }

  async function createJobWith(files: Array<[string, Buffer | string]>) {
    const job = (
      await application.app.inject({ method: 'POST', url: '/api/jobs', headers: HOST })
    ).json<JobSnapshot>();
    for (const [name, content] of files) {
      const { payload, headers } = multipartPayload(name, content);
      const response = await application.app.inject({
        method: 'POST',
        url: `/api/jobs/${job.id}/files`,
        payload,
        headers: { ...headers, ...HOST },
      });
      expect(response.statusCode).toBe(201);
    }
    return job.id;
  }

  async function start(jobId: string, options: Partial<ConversionOptions>) {
    const response = await application.app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/start`,
      headers: HOST,
      payload: { ...baseOptions, ...options },
    });
    expect(response.statusCode).toBe(202);
  }

  async function convert(
    files: Array<[string, Buffer | string]>,
    options: Partial<ConversionOptions>,
  ): Promise<JobSnapshot> {
    const jobId = await createJobWith(files);
    await start(jobId, options);
    await application.jobs.waitForIdle();
    return application.jobs.getJob(jobId);
  }

  async function downloadPayload(job: JobSnapshot, index = 0): Promise<Buffer> {
    const response = await application.app.inject({
      method: 'GET',
      url: `/api/jobs/${job.id}/files/${job.files[index]!.id}/download`,
      headers: HOST,
    });
    expect(response.statusCode).toBe(200);
    return response.rawPayload;
  }

  beforeEach(async () => {
    tempDir = await createTempDir();
  });
  afterEach(async () => {
    await application.app.close();
    await removeDir(tempDir);
  });

  it('Markdown → DOCX: Pandoc in sandbox, immagini del pacchetto incorporate', async () => {
    await setup();
    const job = await convert([['pacchetto.zip', await readFixture('with-images.zip')]], {
      outputFormat: 'docx',
    });
    expect(job.files[0]).toMatchObject({
      status: 'completed',
      result: { fileName: 'pacchetto.docx', warnings: ['REMOTE_IMAGES_BLOCKED'] },
    });
    const pandoc = calls.find((call) => call.tool === 'pandoc')!;
    expect(pandoc.args[0]).toBe('--sandbox');
    expect(pandoc.args).toEqual(expect.arrayContaining(['--from', 'gfm', '--to', 'docx']));
  });

  it('Markdown → PDF: Pandoc e poi LibreOffice', async () => {
    await setup();
    const job = await convert([['nota.md', '# Nota']], {
      outputFormat: 'pdf',
      mode: 'high-fidelity',
    });
    expect(job.files[0]?.result?.fileName).toBe('nota.pdf');
    expect(calls.map((call) => call.tool)).toEqual(['pandoc', 'libreoffice']);
    expect(calls[0]!.args).toEqual(expect.arrayContaining(['--from', 'markdown']));
  });

  it('DOCX → Markdown con immagini separate: ZIP con images/', async () => {
    await setup();
    const job = await convert([['relazione.docx', await readFixture('simple.docx')]], {
      outputFormat: 'markdown',
      imageMode: 'separate',
    });
    expect(job.files[0]?.result).toMatchObject({ fileName: 'relazione.zip', isArchive: true });
    const zip = await downloadPayload(job);
    expect(zip.includes(Buffer.from('relazione.md'))).toBe(true);
    expect(zip.includes(Buffer.from('images/image-001.png'))).toBe(true);
    const pandoc = calls.find((call) => call.tool === 'pandoc')!;
    expect(pandoc.args).toContain('--extract-media=media');
    expect(pandoc.args.some((arg) => arg.endsWith('simplify-markdown.lua'))).toBe(true);
  });

  it('DOCX → Markdown con immagini incorporate: un solo file .md', async () => {
    await setup();
    const job = await convert([['relazione.docx', await readFixture('simple.docx')]], {
      outputFormat: 'markdown',
      imageMode: 'embedded',
      mode: 'high-fidelity',
    });
    expect(job.files[0]?.result).toMatchObject({ fileName: 'relazione.md', isArchive: false });
    expect((await downloadPayload(job)).toString()).toContain('data:image/png;base64,');
  });

  it('DOCX → PDF: LibreOffice con profilo dedicato', async () => {
    await setup();
    const job = await convert([['relazione.docx', await readFixture('simple.docx')]], {
      outputFormat: 'pdf',
    });
    expect(job.files[0]?.result?.fileName).toBe('relazione.pdf');
    const call = calls.find((entry) => entry.tool === 'libreoffice')!;
    expect(call.args[0]).toContain('-env:UserInstallation=file:');
  });

  it('PDF → Markdown: estrazione reale con pdf.js, nessuno strumento esterno', async () => {
    await setup({ available: [] });
    const job = await convert([['rapporto.pdf', await readFixture('text.pdf')]], {
      outputFormat: 'markdown',
      imageMode: 'embedded',
    });
    expect(job.files[0]?.status).toBe('completed');
    const markdown = (await downloadPayload(job)).toString();
    expect(markdown).toContain('# Rapporto di esempio');
    expect(markdown).toContain('data:image/png;base64,');
    expect(calls).toEqual([]);
  });

  it('PDF → DOCX: semplice via Pandoc, alta fedeltà via LibreOffice', async () => {
    await setup();
    const simple = await convert([['a.pdf', await readFixture('text.pdf')]], {
      outputFormat: 'docx',
      mode: 'simple',
    });
    expect(simple.files[0]?.result?.warnings).toContain('LAYOUT_NOT_PRESERVED');
    expect(calls.at(-1)).toMatchObject({ tool: 'pandoc' });
    const high = await convert([['a.pdf', await readFixture('text.pdf')]], {
      outputFormat: 'docx',
      mode: 'high-fidelity',
    });
    expect(high.files[0]?.status).toBe('completed');
    expect(calls.at(-1)?.args).toContain('--infilter=writer_pdf_import');
  });

  it('OCR: eseguito solo se richiesto, con --skip-text e lingue scelte', async () => {
    await setup();
    await convert([['scan.pdf', await readFixture('scanned.pdf')]], { outputFormat: 'markdown' });
    expect(calls.some((call) => call.tool === 'ocrmypdf')).toBe(false);
    await convert([['scan.pdf', await readFixture('scanned.pdf')]], {
      outputFormat: 'markdown',
      ocr: { enabled: true, languages: ['ita', 'eng'], force: false },
    });
    const ocr = calls.find((call) => call.tool === 'ocrmypdf')!;
    expect(ocr.args).toEqual(expect.arrayContaining(['--skip-text', '--language', 'ita+eng']));
  });

  it('OCR senza OCRmyPDF: errore chiaro, le altre conversioni funzionano', async () => {
    await setup({ available: ['pandoc', 'libreoffice', 'tesseract'] });
    const job = await convert(
      [
        ['scan.pdf', await readFixture('scanned.pdf')],
        ['nota.md', '# Nota'],
      ],
      { outputFormat: 'docx', ocr: { enabled: true, languages: ['ita'], force: false } },
    );
    expect(job.files[0]).toMatchObject({ status: 'failed', error: { code: 'DEPENDENCY_MISSING' } });
    expect(job.files[1]?.status).toBe('completed');
  });

  it('OCR con lingua non installata', async () => {
    await setup({ ocrLanguages: ['eng'] });
    const job = await convert([['scan.pdf', await readFixture('scanned.pdf')]], {
      outputFormat: 'markdown',
      ocr: { enabled: true, languages: ['ita'], force: false },
    });
    expect(job.files[0]?.error?.code).toBe('OCR_LANGUAGE_NOT_AVAILABLE');
  });

  it('errore di uno strumento: messaggio comprensibile, stderr non esposto', async () => {
    await setup({ behavior: { pandoc: 'fail' } });
    const job = await convert([['a.md', '# a']], { outputFormat: 'docx' });
    expect(job.files[0]).toMatchObject({ status: 'failed', error: { code: 'CONVERSION_FAILED' } });
    expect(JSON.stringify(job)).not.toContain('secret document text');
    expect(job.files[0]?.error?.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('timeout: lo strumento bloccato viene interrotto', async () => {
    await setup({ behavior: { pandoc: 'hang' }, env: { CONVERSION_TIMEOUT_SECONDS: '1' } });
    const job = await convert([['a.md', '# a']], { outputFormat: 'docx' });
    expect(job.files[0]?.error?.code).toBe('CONVERSION_TIMEOUT');
  });

  it('annullamento durante la conversione e pulizia della directory di lavoro', async () => {
    await setup({ behavior: { pandoc: 'hang' } });
    const jobId = await createJobWith([['a.md', '# a']]);
    await start(jobId, { outputFormat: 'docx' });
    const fileId = application.jobs.getJob(jobId).files[0]!.id;
    await waitFor(() => application.jobs.getJob(jobId).files[0]?.status === 'converting');

    const response = await application.app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/files/${fileId}/cancel`,
      headers: HOST,
    });
    expect(response.statusCode).toBe(202);
    await application.jobs.waitForIdle();
    expect(application.jobs.getJob(jobId).files[0]?.status).toBe('cancelled');
    const workDir = application.tempStore.jobPaths(jobId).work;
    expect(await readdir(workDir)).toEqual([]);
  });

  it("annullamento dell'intero job in coda", async () => {
    await setup({ behavior: { pandoc: 'hang' }, env: { MAX_CONCURRENT_JOBS: '1' } });
    const jobId = await createJobWith([
      ['a.md', '# a'],
      ['b.md', '# b'],
    ]);
    await start(jobId, { outputFormat: 'docx' });
    await waitFor(() =>
      application.jobs.getJob(jobId).files.some((file) => file.status === 'converting'),
    );
    expect(
      application.jobs
        .getJob(jobId)
        .files.map((file) => file.status)
        .sort(),
    ).toEqual(['converting', 'queued']);
    await application.app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/cancel`,
      headers: HOST,
    });
    await application.jobs.waitForIdle();
    expect(application.jobs.getJob(jobId).files.every((file) => file.status === 'cancelled')).toBe(
      true,
    );
  });

  it('dopo il download completo il job viene eliminato', async () => {
    await setup({ env: { CLEANUP_AFTER_DOWNLOAD_SECONDS: '0' } });
    const job = await convert([['a.md', '# a']], { outputFormat: 'docx' });
    const root = application.tempStore.jobPaths(job.id).root;
    await application.app.inject({
      method: 'GET',
      url: `/api/jobs/${job.id}/archive`,
      headers: HOST,
    });
    await waitFor(() => !existsSync(root));
    expect(() => application.jobs.getJob(job.id)).toThrow();
  });

  it('i job inattivi oltre il TTL vengono rimossi', async () => {
    await setup({ env: { JOB_TTL_MINUTES: '1' } });
    const job = await convert([['a.md', '# a']], { outputFormat: 'docx' });
    expect(await application.jobs.removeExpiredJobs(Date.now() + 61_000)).toBe(1);
    expect(existsSync(path.join(application.tempStore.rootDir, `job-${job.id}`))).toBe(false);
  });

  it('dopo un errore restano solo input e nessun output parziale', async () => {
    await setup({ behavior: { libreoffice: 'fail' } });
    const job = await convert([['a.docx', await readFixture('simple.docx')]], {
      outputFormat: 'pdf',
    });
    expect(job.files[0]?.status).toBe('failed');
    const paths = application.tempStore.jobPaths(job.id);
    expect(await readdir(paths.output)).toEqual([]);
    expect(await readdir(paths.work)).toEqual([]);
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('Condizione non raggiunta in tempo');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

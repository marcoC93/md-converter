import type { FileSnapshot, JobSnapshot } from '@md-converter/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, api, type UploadHandle } from '../src/api/client';
import {
  createConversionQueue,
  type QueueDependencies,
} from '../src/composables/useConversionQueue';

const JOB_ID = '11111111-1111-4111-8111-111111111111';

function fileSnapshot(
  id: string,
  name: string,
  overrides: Partial<FileSnapshot> = {},
): FileSnapshot {
  return {
    id,
    displayName: name,
    inputKind: 'markdown',
    sizeBytes: 10,
    status: 'ready',
    progress: null,
    stage: null,
    pdfAnalysis: null,
    result: null,
    error: null,
    ...overrides,
  };
}

function jobSnapshot(files: FileSnapshot[] = [], started = false): JobSnapshot {
  return {
    id: JOB_ID,
    createdAt: new Date().toISOString(),
    options: null,
    started,
    files,
    totalSizeBytes: 0,
  };
}

class FakeEventSource {
  listeners = new Map<string, (event: MessageEvent<string>) => void>();
  onerror: (() => void) | null = null;
  closed = false;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, listener);
  }
  emit(type: string, data: unknown) {
    this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
  close() {
    this.closed = true;
  }
}

function setup(overrides: Partial<typeof api> = {}) {
  const storage = new Map<string, string>();
  const sources: FakeEventSource[] = [];
  let counter = 0;
  const uploads: Array<{
    file: File;
    resolve: (snapshot: FileSnapshot) => void;
    reject: (error: unknown) => void;
  }> = [];
  const downloads: string[] = [];
  const fakeApi = {
    ...api,
    getConfig: vi.fn(async () => ({
      maxFiles: 3,
      maxFileSizeBytes: 1000,
      maxTotalSizeBytes: 5000,
      maxEmbeddedImagesBytes: 100,
      allowedOcrLanguages: ['ita', 'eng'],
      conversionTimeoutSeconds: 300,
    })),
    createJob: vi.fn(async () => jobSnapshot()),
    getJob: vi.fn(async () => jobSnapshot()),
    startJob: vi.fn(async () => jobSnapshot([], true)),
    deleteJob: vi.fn(async () => undefined),
    removeFile: vi.fn(async () => undefined),
    cancelFile: vi.fn(async () => jobSnapshot()),
    ...overrides,
  };
  const deps: QueueDependencies = {
    api: fakeApi,
    uploadFile: (_jobId, file) => {
      const promise = new Promise<FileSnapshot>((resolve, reject) =>
        uploads.push({ file, resolve, reject }),
      );
      const handle: UploadHandle = {
        promise,
        abort: () =>
          uploads.find((upload) => upload.file === file)?.reject(new ApiError('CANCELLED', 'x', 0)),
      };
      return handle;
    },
    createEventSource: () => {
      const source = new FakeEventSource();
      sources.push(source);
      return source as unknown as EventSource;
    },
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => void storage.set(key, value),
      removeItem: (key) => void storage.delete(key),
    },
    download: (url) => downloads.push(url),
  };
  const queue = createConversionQueue(deps);
  const nextId = () => `22222222-2222-4222-8222-${String(++counter).padStart(12, '0')}`;
  return { queue, fakeApi, storage, sources, uploads, downloads, nextId };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('coda di conversione', () => {
  it('scarta lato browser estensioni, dimensioni e numero non validi senza caricarli', async () => {
    const { queue, uploads } = setup();
    await queue.init();
    queue.addFiles([
      new File(['x'], 'virus.exe'),
      new File(['x'.repeat(2000)], 'grande.md'),
      new File(['# a'], 'ok.md'),
    ]);
    await flush();
    expect(
      queue.rows.value.map((row) => [row.item.name, row.status, row.error?.code ?? null]),
    ).toEqual([
      ['virus.exe', 'failed', 'UNSUPPORTED_FILE_TYPE'],
      ['grande.md', 'failed', 'FILE_TOO_LARGE'],
      ['ok.md', 'uploading', null],
    ]);
    expect(uploads).toHaveLength(1);
  });

  it("crea il job, carica e salva l'ID per sopravvivere al refresh", async () => {
    const { queue, uploads, storage, nextId, fakeApi } = setup();
    await queue.init();
    queue.addFiles([new File(['# a'], 'a.md')]);
    await flush();
    expect(fakeApi.createJob).toHaveBeenCalledTimes(1);
    expect(storage.get('md-converter-job')).toBe(JOB_ID);
    uploads[0]!.resolve(fileSnapshot(nextId(), 'a.md'));
    await flush();
    expect(queue.rows.value[0]?.status).toBe('ready');
    expect(queue.canStart.value).toBe(true);
  });

  it("non duplica il file se l'evento SSE arriva prima della risposta dell'upload", async () => {
    const { queue, uploads, sources, nextId } = setup();
    await queue.init();
    queue.addFiles([new File(['# a'], 'a.md')]);
    await flush();
    const id = nextId();
    sources[0]!.emit('job', jobSnapshot([fileSnapshot(id, 'a.md')]));
    uploads[0]!.resolve(fileSnapshot(id, 'a.md'));
    await flush();
    sources[0]!.emit('job', jobSnapshot([fileSnapshot(id, 'a.md')]));
    expect(queue.rows.value).toHaveLength(1);
  });

  it('segue gli aggiornamenti del server fino al completamento', async () => {
    const { queue, uploads, sources, nextId } = setup();
    await queue.init();
    queue.addFiles([new File(['# a'], 'a.md')]);
    await flush();
    const id = nextId();
    uploads[0]!.resolve(fileSnapshot(id, 'a.md'));
    await flush();
    await queue.start();
    sources[0]!.emit(
      'job',
      jobSnapshot(
        [fileSnapshot(id, 'a.md', { status: 'converting', progress: 40, stage: 'extract' })],
        true,
      ),
    );
    expect(queue.rows.value[0]?.server?.progress).toBe(40);
    sources[0]!.emit(
      'job',
      jobSnapshot(
        [
          fileSnapshot(id, 'a.md', {
            status: 'completed',
            result: { fileName: 'a.docx', sizeBytes: 5, isArchive: false, warnings: [] },
          }),
        ],
        true,
      ),
    );
    expect(queue.isFinished.value).toBe(true);
    queue.downloadAll();
    expect(queue.completedCount.value).toBe(1);
  });

  it("impedisce l'avvio con OCR attivo ma senza lingue", async () => {
    const { queue, uploads, nextId } = setup();
    await queue.init();
    queue.addFiles([new File(['# a'], 'a.md')]);
    await flush();
    uploads[0]!.resolve(fileSnapshot(nextId(), 'a.md'));
    await flush();
    queue.options.ocr.enabled = true;
    queue.options.ocr.languages = [];
    expect(queue.canStart.value).toBe(false);
  });

  it('annulla un upload in corso rimuovendolo dalla coda', async () => {
    const { queue } = setup();
    await queue.init();
    queue.addFiles([new File(['# a'], 'a.md')]);
    await flush();
    await queue.cancelRow(queue.rows.value[0]!);
    await flush();
    expect(queue.rows.value).toHaveLength(0);
  });

  it('mostra gli errori di upload del server', async () => {
    const { queue, uploads } = setup();
    await queue.init();
    queue.addFiles([new File(['x'], 'falso.pdf')]);
    await flush();
    uploads[0]!.reject(
      new ApiError('INVALID_FILE_CONTENT', 'Contenuto non valido', 415, undefined, 'abc'),
    );
    await flush();
    expect(queue.rows.value[0]).toMatchObject({
      status: 'failed',
      error: { code: 'INVALID_FILE_CONTENT', correlationId: 'abc' },
    });
  });

  it('gestisce un job scaduto lato server', async () => {
    const { queue, uploads, sources, storage, nextId } = setup();
    await queue.init();
    queue.addFiles([new File(['# a'], 'a.md')]);
    await flush();
    uploads[0]!.resolve(fileSnapshot(nextId(), 'a.md'));
    await flush();
    sources[0]!.emit('deleted', {});
    expect(queue.expired.value).toBe(true);
    expect(queue.job.value).toBeNull();
    expect(storage.has('md-converter-job')).toBe(false);
  });

  it('ripristina la coda dopo un refresh', async () => {
    const id = '33333333-3333-4333-8333-333333333333';
    const { queue, storage } = setup({
      getJob: vi.fn(async () =>
        jobSnapshot([fileSnapshot(id, 'salvato.md', { status: 'completed' })], true),
      ),
    });
    storage.set('md-converter-job', JOB_ID);
    await queue.init();
    expect(queue.rows.value.map((row) => [row.item.name, row.status])).toEqual([
      ['salvato.md', 'completed'],
    ]);
    expect(queue.started.value).toBe(true);
  });

  it('"Nuova conversione" elimina il job sul server', async () => {
    const { queue, uploads, fakeApi, nextId } = setup();
    await queue.init();
    queue.addFiles([new File(['# a'], 'a.md')]);
    await flush();
    uploads[0]!.resolve(fileSnapshot(nextId(), 'a.md'));
    await flush();
    await queue.reset();
    expect(fakeApi.deleteJob).toHaveBeenCalledWith(JOB_ID);
    expect(queue.rows.value).toEqual([]);
  });
});

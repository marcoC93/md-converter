import {
  ACCEPTED_EXTENSIONS,
  DEFAULT_CONVERSION_OPTIONS,
  documentFormatOf,
  isFinalStatus,
  type ConversionOptions,
  type FileSnapshot,
  type FileStatus,
  type JobSnapshot,
  type PublicConfig,
} from '@md-converter/shared';
import { computed, reactive, ref } from 'vue';
import { api, ApiError, triggerDownload, uploadFile, type UploadHandle } from '../api/client';
import { extensionOf } from '../utils/format';

export type ItemStatus = FileStatus | 'uploading';

export interface ItemError {
  code: string;
  message: string;
  details?: string | undefined;
  correlationId?: string | undefined;
}

/** Un file come lo vede il browser: può non essere ancora (o non essere mai) arrivato al server. */
export interface QueueItem {
  localId: string;
  name: string;
  size: number;
  fileId: string | null;
  uploadProgress: number | null;
  localError: ItemError | null;
  abortUpload: (() => void) | null;
}

/** Riga della coda: unisce lo stato locale con quello inviato dal server. */
export interface QueueRow {
  item: QueueItem;
  server: FileSnapshot | null;
  status: ItemStatus;
  error: ItemError | null;
}

export interface QueueDependencies {
  api: typeof api;
  uploadFile: (jobId: string, file: File, onProgress: (percent: number) => void) => UploadHandle;
  createEventSource: (url: string) => EventSource;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  download: (url: string) => void;
}

const JOB_STORAGE_KEY = 'md-converter-job';

function toItemError(error: unknown): ItemError {
  if (error instanceof ApiError)
    return {
      code: error.code,
      message: error.message,
      details: error.details,
      correlationId: error.correlationId,
    };
  return { code: 'INTERNAL_ERROR', message: 'Errore imprevisto.' };
}

/**
 * Stato e azioni della coda di conversione. È una "factory" per poterla testare con dipendenze
 * finte; l'applicazione usa l'istanza condivisa restituita da `useConversionQueue()`.
 */
export function createConversionQueue(deps: QueueDependencies) {
  const items = ref<QueueItem[]>([]);
  const job = ref<JobSnapshot | null>(null);
  const options = reactive<ConversionOptions>(structuredClone(DEFAULT_CONVERSION_OPTIONS));
  const config = ref<PublicConfig | null>(null);
  const starting = ref(false);
  const lastError = ref<ItemError | null>(null);
  const expired = ref(false);
  let events: EventSource | null = null;
  let jobCreation: Promise<string> | null = null;
  let uploadChain: Promise<void> = Promise.resolve();
  let nextLocalId = 1;

  const rows = computed<QueueRow[]>(() =>
    items.value.map((item) => {
      const server = item.fileId
        ? (job.value?.files.find((file) => file.id === item.fileId) ?? null)
        : null;
      if (item.localError) return { item, server, status: 'failed', error: item.localError };
      if (!server)
        return { item, server, status: item.fileId ? 'validating' : 'uploading', error: null };
      return { item, server, status: server.status, error: server.error };
    }),
  );

  const started = computed(() => job.value?.started ?? false);
  const countBy = (status: ItemStatus) => rows.value.filter((row) => row.status === status).length;
  const readyCount = computed(() => countBy('ready'));
  const completedCount = computed(() => countBy('completed'));
  const failedCount = computed(() => countBy('failed'));
  const isFinished = computed(
    () =>
      started.value &&
      rows.value.length > 0 &&
      rows.value.every(
        (row) => row.status !== 'uploading' && isFinalStatus(row.status as FileStatus),
      ),
  );
  const ocrLanguagesValid = computed(
    () => !options.ocr.enabled || options.ocr.languages.length > 0,
  );
  const canStart = computed(
    () =>
      !started.value &&
      !starting.value &&
      readyCount.value > 0 &&
      !rows.value.some((row) => row.status === 'uploading' || row.status === 'validating') &&
      ocrLanguagesValid.value,
  );
  const hasPdf = computed(() => rows.value.some((row) => extensionOf(row.item.name) === '.pdf'));

  /** Applica lo stato ricevuto dal server, aggiungendo i file che il browser non conosce (es. dopo un refresh). */
  function applySnapshot(snapshot: JobSnapshot): void {
    job.value = snapshot;
    const known = new Set(items.value.map((item) => item.fileId));
    // Con upload in corso un file sconosciuto è quasi sempre il nostro: lo associamo alla fine dell'upload.
    const uploadsPending = items.value.some(
      (item) => item.fileId === null && item.localError === null,
    );
    for (const file of snapshot.files) {
      if (!known.has(file.id) && !uploadsPending && file.status !== 'validating') {
        items.value.push({
          localId: `server-${file.id}`,
          name: file.displayName,
          size: file.sizeBytes,
          fileId: file.id,
          uploadProgress: null,
          localError: null,
          abortUpload: null,
        });
      }
    }
    const serverIds = new Set(snapshot.files.map((file) => file.id));
    items.value = items.value.filter(
      (item) =>
        item.fileId === null ||
        item.localError !== null ||
        serverIds.has(item.fileId) ||
        item.abortUpload !== null,
    );
  }

  function connectEvents(jobId: string): void {
    events?.close();
    events = deps.createEventSource(deps.api.eventsUrl(jobId));
    events.addEventListener('job', (event) =>
      applySnapshot(JSON.parse((event as MessageEvent<string>).data) as JobSnapshot),
    );
    events.addEventListener('deleted', () => handleExpired());
    events.onerror = () => {
      // EventSource riprova da solo; se il job non esiste più smettiamo.
      deps.api.getJob(jobId).then(applySnapshot, (error: unknown) => {
        if (error instanceof ApiError && error.code === 'NOT_FOUND') handleExpired();
      });
    };
  }

  function handleExpired(): void {
    events?.close();
    events = null;
    deps.storage.removeItem(JOB_STORAGE_KEY);
    if (job.value) expired.value = true;
    job.value = null;
    items.value = items.value.filter((item) => item.fileId === null && item.localError !== null);
  }

  async function ensureJob(): Promise<string> {
    if (job.value) return job.value.id;
    jobCreation ??= deps.api.createJob().then((created) => {
      job.value = created;
      expired.value = false;
      deps.storage.setItem(JOB_STORAGE_KEY, created.id);
      connectEvents(created.id);
      return created.id;
    });
    try {
      return await jobCreation;
    } finally {
      jobCreation = null;
    }
  }

  async function init(): Promise<void> {
    config.value = await deps.api.getConfig().catch(() => null);
    if (
      config.value &&
      !config.value.allowedOcrLanguages.includes(options.ocr.languages[0] ?? '')
    ) {
      options.ocr.languages = config.value.allowedOcrLanguages.slice(0, 1);
    }
    const savedJobId = deps.storage.getItem(JOB_STORAGE_KEY);
    if (!savedJobId) return;
    try {
      const snapshot = await deps.api.getJob(savedJobId);
      applySnapshot(snapshot);
      if (snapshot.options) Object.assign(options, structuredClone(snapshot.options));
      connectEvents(savedJobId);
    } catch {
      deps.storage.removeItem(JOB_STORAGE_KEY);
    }
  }

  /** Controlli lato browser: evitano upload inutili. Il server ripete comunque tutte le verifiche. */
  function precheck(file: File, queuedCount: number): ItemError | null {
    if (!ACCEPTED_EXTENSIONS.includes(extensionOf(file.name)))
      return { code: 'UNSUPPORTED_FILE_TYPE', message: 'Tipo di file non supportato.' };
    if (config.value && file.size > config.value.maxFileSizeBytes)
      return { code: 'FILE_TOO_LARGE', message: 'File troppo grande.' };
    if (config.value && queuedCount >= config.value.maxFiles)
      return { code: 'TOO_MANY_FILES', message: 'Troppi file.' };
    return null;
  }

  function addFiles(files: Iterable<File>): number {
    if (started.value) return 0;
    let added = 0;
    for (const file of files) {
      const accepted = items.value.filter((item) => item.localError === null).length;
      const item: QueueItem = {
        localId: `local-${nextLocalId++}`,
        name: file.name,
        size: file.size,
        fileId: null,
        uploadProgress: 0,
        localError: precheck(file, accepted),
        abortUpload: null,
      };
      items.value.push(item);
      added++;
      if (!item.localError) {
        // Upload uno alla volta: più semplice da seguire e non satura il disco con file grandi.
        uploadChain = uploadChain.then(() => upload(item.localId, file));
      }
    }
    return added;
  }

  function findItem(localId: string): QueueItem | undefined {
    return items.value.find((item) => item.localId === localId);
  }

  async function upload(localId: string, file: File): Promise<void> {
    if (!findItem(localId)) return;
    try {
      const jobId = await ensureJob();
      const handle = deps.uploadFile(jobId, file, (percent) => {
        const current = findItem(localId);
        if (current) current.uploadProgress = percent;
      });
      const item = findItem(localId);
      if (!item) return handle.abort();
      item.abortUpload = handle.abort;
      const snapshot = await handle.promise;
      // L'evento SSE può arrivare prima della risposta dell'upload e aver già creato una riga per
      // questo file: la togliamo, così resta solo la riga locale.
      items.value = items.value.filter(
        (entry) => entry.localId === localId || entry.fileId !== snapshot.id,
      );
      const uploaded = findItem(localId);
      if (uploaded) {
        uploaded.fileId = snapshot.id;
        uploaded.uploadProgress = null;
        uploaded.abortUpload = null;
        if (job.value && !job.value.files.some((entry) => entry.id === snapshot.id))
          job.value.files.push(snapshot);
      }
    } catch (error) {
      const item = findItem(localId);
      if (!item) return;
      item.abortUpload = null;
      if (error instanceof ApiError && error.code === 'CANCELLED')
        items.value = items.value.filter((entry) => entry.localId !== localId);
      else item.localError = toItemError(error);
    }
  }

  async function start(): Promise<void> {
    if (!job.value || !canStart.value) return;
    starting.value = true;
    lastError.value = null;
    try {
      applySnapshot(
        await deps.api.startJob(
          job.value.id,
          structuredClone({
            ...options,
            ocr: { ...options.ocr, languages: [...options.ocr.languages] },
          }),
        ),
      );
    } catch (error) {
      lastError.value = toItemError(error);
    } finally {
      starting.value = false;
    }
  }

  async function runAction(action: () => Promise<unknown>): Promise<void> {
    lastError.value = null;
    try {
      const result = await action();
      if (result && typeof result === 'object' && 'files' in result)
        applySnapshot(result as JobSnapshot);
    } catch (error) {
      lastError.value = toItemError(error);
    }
  }

  async function cancelRow(row: QueueRow): Promise<void> {
    if (row.status === 'uploading') {
      row.item.abortUpload?.();
      return;
    }
    if (job.value && row.item.fileId)
      await runAction(() => deps.api.cancelFile(job.value!.id, row.item.fileId!));
  }

  async function removeRow(row: QueueRow): Promise<void> {
    row.item.abortUpload?.();
    items.value = items.value.filter((item) => item.localId !== row.item.localId);
    if (job.value && row.item.fileId)
      await runAction(() => deps.api.removeFile(job.value!.id, row.item.fileId!));
  }

  async function cancelAll(): Promise<void> {
    if (job.value) await runAction(() => deps.api.cancelJob(job.value!.id));
  }

  function downloadRow(row: QueueRow): void {
    if (job.value && row.item.fileId && row.status === 'completed')
      deps.download(deps.api.downloadUrl(job.value.id, row.item.fileId));
  }

  function downloadAll(): void {
    if (job.value && completedCount.value > 0) deps.download(deps.api.archiveUrl(job.value.id));
  }

  async function reset(): Promise<void> {
    for (const item of items.value) item.abortUpload?.();
    const jobId = job.value?.id;
    events?.close();
    events = null;
    job.value = null;
    items.value = [];
    expired.value = false;
    deps.storage.removeItem(JOB_STORAGE_KEY);
    if (jobId) await deps.api.deleteJob(jobId).catch(() => undefined);
  }

  /** Strumenti che mancano per convertire questo file con le opzioni attuali (verifica preventiva). */
  function inputFormatOf(row: QueueRow) {
    return row.server?.inputKind ? documentFormatOf(row.server.inputKind) : null;
  }

  function dispose(): void {
    events?.close();
    events = null;
  }

  return {
    items,
    rows,
    job,
    options,
    config,
    starting,
    lastError,
    expired,
    started,
    readyCount,
    completedCount,
    failedCount,
    isFinished,
    canStart,
    hasPdf,
    ocrLanguagesValid,
    init,
    addFiles,
    start,
    cancelRow,
    removeRow,
    cancelAll,
    downloadRow,
    downloadAll,
    reset,
    inputFormatOf,
    dispose,
  };
}

export type ConversionQueue = ReturnType<typeof createConversionQueue>;

let sharedQueue: ConversionQueue | null = null;

export function useConversionQueue(): ConversionQueue {
  sharedQueue ??= createConversionQueue({
    api,
    uploadFile,
    createEventSource: (url) => new EventSource(url),
    storage: window.sessionStorage,
    download: triggerDownload,
  });
  return sharedQueue;
}

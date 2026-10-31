# Guida al codice

Questa guida descrive **come è implementato** il convertitore, file per file: cosa fa ogni
modulo, le funzioni principali e come si collegano. Per il _perché_ delle scelte vedi
[architecture.md](architecture.md); per le pipeline di conversione vedi
[conversion-matrix.md](conversion-matrix.md).

Indice:

1. [Pacchetto condiviso (`packages/shared`)](#1-pacchetto-condiviso-packagesshared)
2. [Backend (`apps/backend`)](#2-backend-appsbackend)
3. [Frontend (`apps/frontend`)](#3-frontend-appsfrontend)
4. [Come passa un file attraverso il codice](#4-come-passa-un-file-attraverso-il-codice)
5. [Test: dove si trova cosa](#5-test-dove-si-trova-cosa)
6. [Correzioni importanti e dove sono nel codice](#6-correzioni-importanti-e-dove-sono-nel-codice)

---

## 1. Pacchetto condiviso (`packages/shared`)

Contiene solo **tipi TypeScript e costanti**, senza dipendenze. Backend e frontend lo importano
come `@md-converter/shared`, così parlano la stessa "lingua" (stessi nomi di stati, formati e
codici di errore). Viene compilato in `dist/` con `tsc` (`pnpm build:shared`).

| File             | Contenuto                                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `formats.ts`     | `DOCUMENT_FORMATS` (`markdown`, `docx`, `pdf`), `INPUT_KINDS` (in più `markdown-bundle`, lo ZIP), `INPUT_EXTENSIONS`, `ACCEPTED_EXTENSIONS`, `documentFormatOf()` |
| `options.ts`     | `ConversionOptions` (formato di uscita, modalità, immagini, OCR) e `DEFAULT_CONVERSION_OPTIONS` (OCR spento, immagini separate)                                   |
| `job.ts`         | `FileStatus`, `FileSnapshot`, `JobSnapshot`, `JobReport`, `isFinalStatus()`                                                                                       |
| `errors.ts`      | `API_ERROR_CODES` (errori HTTP), `CONVERSION_ERROR_CODES` (errori per file), `WARNING_CODES`, `ApiErrorBody`                                                      |
| `diagnostics.ts` | `ToolStatus`, `ConversionCapability`, `DiagnosticsReport`, `PublicConfig`                                                                                         |

Gli elenchi sono scritti come `['a', 'b'] as const` e il tipo si ricava dall'elenco:

```ts
export const FILE_STATUSES = [
  'validating',
  'ready',
  'queued',
  'converting',
  'completed',
  'cancelled',
  'failed',
] as const;
export type FileStatus = (typeof FILE_STATUSES)[number]; // 'validating' | 'ready' | ...
```

Così lo stesso elenco serve sia a runtime (validazione, cicli nell'interfaccia) sia per i tipi.

`JobSnapshot` è lo stato di un job **come lo vede il browser**: nessun percorso del filesystem,
solo ID casuali e dati da mostrare. Il campo `revision` cresce a ogni modifica (vedi
[sezione 6](#6-correzioni-importanti-e-dove-sono-nel-codice)).

---

## 2. Backend (`apps/backend`)

### 2.1 Avvio e configurazione

| File                  | Ruolo                                                                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`        | punto di ingresso: carica la config, costruisce l'app, pulisce le directory orfane, controlla le dipendenze, avvia la pulizia periodica, gestisce `SIGINT`/`SIGTERM` |
| `src/config.ts`       | `loadConfig(env)`: valida le variabili d'ambiente con **Zod** e restituisce un `AppConfig` tipizzato (MB convertiti in byte, minuti in millisecondi)                 |
| `src/app.ts`          | `buildApp(config, overrides)`: crea l'istanza Fastify e collega tutti i pezzi; **non** apre la porta, così i test usano `app.inject()`                               |
| `src/cli/diagnose.ts` | comando `pnpm diagnose`: stampa nel terminale lo stato degli strumenti                                                                                               |

`loadConfig` rifiuta un `HOST` diverso da loopback se `ALLOW_NON_LOOPBACK` non è `true`:

```ts
if (!isLoopbackHost(values.HOST) && !values.ALLOW_NON_LOOPBACK) {
  throw new ConfigError(`HOST=${values.HOST} esporrebbe il servizio sulla rete. ...`);
}
```

`buildApp` è il punto in cui si vede tutta l'applicazione insieme:

```ts
const tempStore = new TempStore(config.tempDir);                     // directory dei job
const registry = new DependencyRegistry(tempStore, config, ...);    // strumenti trovati
const executor = overrides.executor ?? createToolExecutor((tool) => registry.toolPath(tool));
const jobs = new JobService(tempStore, events, { executor, ... }, limits, app.log);

registerSystemRoutes(app, config, registry);   // /api/health, /api/config, /api/diagnostics
registerJobRoutes(app, config, jobs);          // creazione job, upload, start, cancel, delete
registerEventRoutes(app, jobs, events);        // SSE
registerDownloadRoutes(app, jobs);             // download singolo e ZIP
registerFrontend(app, config.frontendDistDir); // file statici di Vue + fallback a index.html
```

Il parametro `overrides` permette ai test di sostituire `executor` (strumenti finti) e
`dependencyChecker` (diagnostica finta) senza toccare il resto.

### 2.2 Livello HTTP (`src/http/`)

| File                  | Cosa fa                                                                                                                                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `errors.ts`           | classe `AppError(code, details?)`: codice stabile + stato HTTP + messaggio italiano predefinito; `toInfo(correlationId)` produce il JSON dell'errore                                                                                               |
| `error-handler.ts`    | `setErrorHandler` unico: converte `AppError`, `ZodError` e gli errori di Fastify/multipart nel formato `{ error: { code, message, details, correlationId } }`; qualsiasi altro errore diventa `INTERNAL_ERROR` e lo stack trace resta solo nel log |
| `security-headers.ts` | hook `onRequest` che aggiunge CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `X-Correlation-Id` e `Cache-Control: no-store` per `/api`                                                                                                      |
| `request-guard.ts`    | hook `onRequest` anti DNS rebinding (header `Host`) e anti CSRF (`Origin` per POST/DELETE, `Sec-Fetch-Site: cross-site`)                                                                                                                           |

Ogni richiesta riceve un ID casuale (`genReqId: () => randomUUID()`): è l'**ID di correlazione**
che compare negli header, negli errori e nei log.

### 2.3 Rotte (`src/routes/`)

Ogni file registra un gruppo di endpoint. I parametri vengono validati con Zod **prima** di usarli:

```ts
// schemas.ts
export const fileParamsSchema = z.object({ jobId: z.uuid(), fileId: z.uuid() });

// job-routes.ts
app.post('/api/jobs/:jobId/start', async (request, reply) => {
  const { jobId } = jobParamsSchema.parse(request.params); // ID non UUID → 400
  const options = optionsSchema.parse(request.body); // opzioni non valide → 400
  return reply.status(202).send(jobs.start(jobId, options));
});
```

`conversionOptionsSchema(allowedOcrLanguages)` usa `.strict()` (campi sconosciuti rifiutati) e
`satisfies z.ZodType<ConversionOptions>`, così TypeScript segnala ogni differenza con il tipo
condiviso.

| File                 | Endpoint                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `system-routes.ts`   | `GET /api/health`, `GET /api/config`, `GET /api/diagnostics[?refresh=true]`                                                                                                           |
| `job-routes.ts`      | `POST /api/jobs`, `GET/DELETE /api/jobs/:id`, `POST .../files` (upload), `DELETE .../files/:fileId`, `POST .../start`, `POST .../cancel`, `POST .../files/:fileId/cancel`             |
| `event-routes.ts`    | `GET /api/jobs/:id/events`: risposta SSE con `reply.hijack()`, invio dello stato iniziale, un evento `job` a ogni modifica, `deleted` alla cancellazione, commento `: ping` ogni 15 s |
| `download-routes.ts` | `GET .../files/:fileId/download` e `GET .../archive`; usano lo stream del file e, all'evento `finish`, chiamano `markDownloaded()`                                                    |

### 2.4 Job, coda e stati (`src/jobs/`)

| File                  | Cosa fa                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `job-service.ts`      | classe `JobService`, il "regista": crea job, riceve file, avvia, annulla, scarica, pulisce                                     |
| `job-records.ts`      | `FileRecord`/`JobRecord` (stato interno, con percorsi reali) e `jobSnapshot()` che produce la versione pubblica senza percorsi |
| `file-state.ts`       | tabella delle transizioni ammesse e `assertTransition(from, to)`                                                               |
| `conversion-queue.ts` | `ConversionQueue`: esegue al massimo N compiti insieme (`MAX_CONCURRENT_JOBS`)                                                 |
| `job-events.ts`       | `JobEvents`: piccolo wrapper su `EventEmitter` usato dallo stream SSE                                                          |
| `upload.ts`           | `saveUpload()`: scrive lo stream dell'upload su disco contando i byte; oltre il limite interrompe e cancella il file parziale  |

Metodi principali di `JobService`:

| Metodo                              | Cosa fa                                                                                                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createJob()`                       | crea `job-<uuid>/{input,work,output}`; con troppi job attivi prova a eliminare quelli scaduti, poi `SERVICE_BUSY`                                                                                                                                            |
| `addFile(jobId, incoming)`          | controlli su stato, numero, estensione e MIME → stato `validating` → salvataggio con nome interno `<fileId>.<ext>` → `validateFileContent()` → per i PDF `analyzePdf()` → stato `ready`. In caso di errore il file viene scartato e l'errore torna al client |
| `start(jobId, options)`             | salva le opzioni, porta i file `ready` in `queued` e li mette in coda con `queue.enqueue(() => this.convertFile(...))`                                                                                                                                       |
| `convertFile()` (privato)           | `converting` → `runConversion()` → `completed` oppure `failed`/`cancelled`; cancella l'output parziale in caso di errore                                                                                                                                     |
| `cancelFile()` / `cancelJob()`      | chiama `abortController.abort()` (che termina i processi figli) e imposta `cancelled`                                                                                                                                                                        |
| `getDownload()` / `createArchive()` | restituiscono percorso e nome del risultato / uno stream ZIP con risultati e `report.json`                                                                                                                                                                   |
| `markDownloaded()`                  | quando tutti i risultati sono stati scaricati programma l'eliminazione del job                                                                                                                                                                               |
| `removeExpiredJobs()`               | elimina i job inattivi oltre il TTL (non quelli con conversioni in corso)                                                                                                                                                                                    |
| `shutdown()`                        | arresto: annulla tutto, attende la coda (max 10 s), cancella tutte le directory                                                                                                                                                                              |

Ogni cambio di stato passa da due metodi privati:

```ts
private setStatus(job, file, status, publish = true) {
  assertTransition(file.status, status);  // blocca le transizioni non previste (bug)
  file.status = status;
  this.touch(job);                        // aggiorna l'ultima attività (per il TTL)
  if (publish) this.publish(job);
}

private publish(job) {
  job.revision++;                         // ogni modifica ha un numero crescente
  this.events.publish(job.id, { type: 'job', job: jobSnapshot(job) });
}
```

### 2.5 File e sicurezza (`src/files/`)

| File                   | Funzioni principali                                                                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `temp-store.ts`        | `TempStore`: `createJobDirs()`, `jobPaths()`, `removeJobDir()`, `removeInside()`, `removeStaleJobDirs()`. Ogni cancellazione verifica che il percorso sia dentro `TEMP_DIR` e che la cartella si chiami `job-<uuid>` |
| `safe-path.ts`         | `isSafeRelativePath()` (rifiuta assoluti, `..`, lettere di unità, NUL), `resolveInside()`, `isPathInside()`                                                                                                          |
| `sanitize-filename.ts` | `sanitizeFileName()` (toglie percorsi, caratteri vietati, nomi riservati di Windows, limita la lunghezza), `uniqueFileName()`, `contentDisposition()`                                                                |
| `file-validation.ts`   | `detectInputKind()` (dall'estensione), `isDeclaredMimeAccepted()`, `validateFileContent()` (firma PDF, struttura DOCX, UTF-8 per Markdown, un solo `.md` nel pacchetto ZIP)                                          |
| `zip-inspect.ts`       | `inspectZip()` (elenca senza estrarre, con limiti anti zip-bomb), `extractZip()` (estrae solo le voci scelte con `resolveInside` → niente ZIP Slip)                                                                  |
| `zip-writer.ts`        | `createZipStream()` (ZIP in streaming, per i download) e `writeZipFile()`                                                                                                                                            |

### 2.6 Processi esterni (`src/process/`)

| File                    | Cosa fa                                                                                                                                                                                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `process-runner.ts`     | `runProcess({ command, args, cwd, timeoutMs, signal, env })`: `spawn` con array di argomenti e `shell: false`, timeout, annullamento, output conservato solo per gli ultimi 64 KB. `killProcessTree()` usa `taskkill /T /F` su Windows e il gruppo di processi (`process.kill(-pid)`) su Linux/macOS |
| `child-env.ts`          | `buildChildEnv(workDir, parentEnv, extraPathDirs)`: ambiente minimo per i processi figli; `TMP`/`HOME` puntano alla directory del job; una sola variabile `PATH`, con eventuali cartelle aggiuntive in testa                                                                                         |
| `resolve-executable.ts` | `resolveExecutable({ configuredPath, names, knownLocations })`: percorso configurato → PATH (solo directory assolute) → posizioni note; su Windows accetta solo `.exe`/`.com`                                                                                                                        |

Gli errori di `runProcess` sono `ProcessError` con un `kind`: `spawn-failed`, `timeout`,
`cancelled`, `exit-code`.

### 2.7 Adapter degli strumenti (`src/tools/`)

Ogni adapter separa **costruzione degli argomenti** (funzione pura, facile da testare) ed
**esecuzione** (tramite un `ToolExecutor`).

| File               | Funzioni                                                                                                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tool-executor.ts` | tipo `ToolExecutor`, `createToolExecutor(resolvePath)`, `CancelledError`, `toConversionError()` (traduce `ProcessError` in `AppError`, senza mai esporre stderr)                                         |
| `tool-catalog.ts`  | `toolLookup(tool, config)`: nomi e posizioni tipiche di ogni strumento per Windows, macOS e Linux                                                                                                        |
| `pandoc.ts`        | `buildPandocArgs()` (sempre `--sandbox`, `--` prima del file), `markdownDialect(mode)` (`gfm` o `markdown`), `runPandoc()`, `SIMPLIFY_MARKDOWN_FILTER`                                                   |
| `libreoffice.ts`   | `buildLibreOfficeArgs()` (profilo dedicato `-env:UserInstallation=file:///...`, `--infilter=writer_pdf_import` per i PDF), `convertWithLibreOffice()` (controlla che il file sia stato davvero prodotto) |
| `ocrmypdf.ts`      | `buildOcrmypdfArgs()` (`--skip-text` o `--force-ocr`, lingue validate con regex), `mapOcrmypdfExitCode()`, `runOcrmypdf()`                                                                               |
| `tesseract.ts`     | parsing di versione e lingue (`--list-langs`), usati dalla diagnostica                                                                                                                                   |

`createToolExecutor` aggiunge al PATH dei processi figli la cartella di Tesseract, perché
OCRmyPDF lo avvia a sua volta cercandolo nel PATH:

```ts
const NESTED_TOOLS: readonly ToolId[] = ['tesseract'];
const extraPathDirs = NESTED_TOOLS.map(resolvePath)
  .filter((resolved): resolved is string => resolved !== null)
  .map((resolved) => path.dirname(resolved));
return runProcess({ ..., env: buildChildEnv(options.cwd, process.env, extraPathDirs) });
```

`assets/pandoc/simplify-markdown.lua` è un filtro Lua usato in modalità semplice DOCX → Markdown:
toglie gli attributi delle immagini e trasforma le figure in immagine + didascalia in corsivo,
così Pandoc non scrive HTML nel Markdown.

### 2.8 Diagnostica (`src/diagnostics/`)

- `dependency-checker.ts` → `checkDependencies(config, workDir, probe)`: per ogni strumento
  risolve il percorso, esegue `--version` (per LibreOffice con un profilo temporaneo), legge la
  versione, per Tesseract anche `--list-langs`. Restituisce il `DiagnosticsReport` pubblico e,
  separatamente, i percorsi completi ad uso interno. `computeCapabilities()` deduce quali
  conversioni sono disponibili.
- `dependency-registry.ts` → `DependencyRegistry`: conserva l'ultimo risultato (`toolPath()`,
  `isAvailable()`, `ocrLanguages()`), lo ricalcola su richiesta con `refresh()` ed evita controlli
  paralleli duplicati.

### 2.9 Motore di conversione (`src/conversion/`)

| File                         | Cosa fa                                                                                                                                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pipeline-types.ts`          | `PipelineContext` (input, directory, opzioni, executor, segnale di annullamento, limiti, `reportProgress`) e `PipelineResult`                                                                                                      |
| `pipeline-selector.ts`       | `selectPipeline(inputKind, options)` → la pipeline giusta con gli strumenti richiesti; `requiredTools()` aggiunge OCRmyPDF/Tesseract se serve                                                                                      |
| `run-conversion.ts`          | `runConversion(request, environment)`: verifica strumenti e lingue **prima** di iniziare, combina annullamento utente e timeout (`AbortSignal.any`), controlla la dimensione del risultato, cancella sempre la directory di lavoro |
| `pipelines/from-markdown.ts` | `markdownToDocx()`, `markdownToPdf()` (DOCX intermedio + LibreOffice)                                                                                                                                                              |
| `pipelines/from-docx.ts`     | `docxToMarkdown()` (Pandoc con `--extract-media=media`), `docxToPdf()`                                                                                                                                                             |
| `pipelines/from-pdf.ts`      | `preparePdf()` (OCR opzionale), `pdfToMarkdown()`, `pdfToDocxSimple()`, `pdfToDocxHighFidelity()`                                                                                                                                  |
| `markdown-bundle.ts`         | `prepareMarkdownInput()`: estrae il pacchetto ZIP; `inlineLocalImages()` trasforma le immagini locali in data URI e segnala quelle remote o mancanti; `createBundleImageResolver()` legge solo dentro il pacchetto                 |
| `markdown-images.ts`         | `finalizeMarkdownImages()`: rinomina le immagini in `images/image-001.png` oppure le incorpora in Base64, con ripiego automatico oltre `MAX_EMBEDDED_IMAGES_MB`                                                                    |
| `markdown-output.ts`         | `writeMarkdownResult()`: scrive `result.md` oppure `result.zip` (`nome.md` + `images/`)                                                                                                                                            |
| `markdown-text.ts`           | escape dei caratteri speciali Markdown (gli URL restano intatti), link e immagini sicuri                                                                                                                                           |

Ogni pipeline è una funzione `(context) => Promise<PipelineResult>`. Esempio:

```ts
export async function docxToPdf(context: PipelineContext): Promise<PipelineResult> {
  context.reportProgress('libreoffice', null);
  const pdfPath = await convertWithLibreOffice(
    context.executor,
    {
      inputPath: context.inputPath,
      outputDir: path.join(context.workDir, 'libreoffice-out'),
      target: 'pdf',
    },
    toolOptions(context),
  );
  const outputPath = path.join(context.outputDir, 'result.pdf');
  await rename(pdfPath, outputPath);
  return { outputPath, fileName: `${context.outputBaseName}.pdf`, isArchive: false, warnings: [] };
}
```

Sul disco i file hanno sempre nomi interni (`result.pdf`); il nome che l'utente vede
(`fileName`) viene dal nome originale sanitizzato.

#### PDF → Markdown (`src/conversion/pdf/`)

| File                 | Cosa fa                                                                                                                                                                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pdf-document.ts`    | `openPdf()`: apre il PDF con pdf.js senza font di sistema né rete (CMap, font e WASM locali); PDF con password → `PDF_ENCRYPTED`                                                                                                                                              |
| `pdf-analysis.ts`    | `analyzePdf()`: caratteri per pagina sulle prime 30 pagine → `ocrSuggested` sotto i 20 caratteri                                                                                                                                                                              |
| `pdf-extract.ts`     | `extractPageContent(page)`: frammenti di testo con posizione e dimensione del carattere, link (solo `http`, `https`, `mailto`), immagini con posizione ricavata dalla matrice di trasformazione                                                                               |
| `pdf-images.ts`      | `loadPdfImage()` e `encodePng()`: converte i pixel di pdf.js (1 bit, RGB, RGBA) in PNG con pngjs; scarta immagini oltre 25 Mpx                                                                                                                                                |
| `pdf-layout.ts`      | funzioni pure: `groupIntoLines()`, `findMarginLines()` (intestazioni/piè di pagina ripetuti), `bodyFontSize()`, `headingLevels()`, `buildTextBlocks()` (titoli, elenchi, paragrafi, parole col trattino), `insertImages()`, `applyCaptions()`, `mergeParagraphsAcrossPages()` |
| `pdf-to-markdown.ts` | `convertPdfToMarkdown()`: legge le pagine una alla volta (avanzamento e annullamento tra una pagina e l'altra), applica le euristiche e produce il Markdown con `renderBlocks()`                                                                                              |

---

## 3. Frontend (`apps/frontend`)

### 3.1 Struttura

```
src/
├── main.ts                    createApp(App).mount('#app') + CSS globale
├── App.vue                    layout della pagina e collegamento dei componenti
├── api/client.ts              chiamate HTTP tipizzate
├── composables/               stato e logica riutilizzabile (Composition API)
├── components/                componenti visivi piccoli
├── i18n/                      dizionario italiano e funzione t()
├── styles/main.css            variabili CSS, temi, stili comuni, prefers-reduced-motion
└── utils/format.ts            formatBytes(), extensionOf()
public/theme-init.js           applica il tema salvato prima del rendering (file esterno per la CSP)
```

### 3.2 Client API (`src/api/client.ts`)

- `api.*`: una funzione per endpoint (`createJob`, `getJob`, `startJob`, `cancelFile`, ...) basata
  su `fetch`. Se la risposta non è OK lancia `ApiError(code, message, status, details,
correlationId)` leggendo il formato d'errore del backend; senza connessione il codice è
  `NETWORK_ERROR`.
- `uploadFile(jobId, file, onProgress)`: usa `XMLHttpRequest` invece di `fetch` perché XHR
  fornisce l'avanzamento dell'upload (`xhr.upload.onprogress`). Restituisce `{ promise, abort }`.
- `triggerDownload(url)`: crea un `<a download>` temporaneo e lo clicca.

### 3.3 Composable

Un _composable_ è una funzione `useX()` che raggruppa stato reattivo (`ref`, `computed`) e
funzioni. Lo stato dichiarato **fuori** dalla funzione è condiviso da tutti i componenti che la
usano: per questo il progetto non ha bisogno di Pinia.

| File                       | Cosa espone                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `useConversionQueue.ts`    | lo stato della coda e tutte le azioni (vedi sotto)                                                       |
| `useDiagnostics.ts`        | `report`, `load(refresh)`, `ocrAvailable`, `ocrLanguages`, `capability(from, to)`                        |
| `useTheme.ts`              | `theme` (`system`/`light`/`dark`); un `watch` imposta `data-theme` su `<html>` e salva in `localStorage` |
| `useAnnouncer.ts`          | `announce()` ed `announceError()`: testi per le regioni `aria-live`                                      |
| `useQueueAnnouncements.ts` | osserva gli stati delle righe e annuncia "file: completato", gli errori e la fine del lotto              |

#### `useConversionQueue.ts`

È diviso in due:

- `createConversionQueue(deps)`: la logica vera; riceve le dipendenze (`api`, `uploadFile`,
  `createEventSource`, `storage`, `download`) così nei test si passano versioni finte;
- `useConversionQueue()`: crea una sola istanza con le dipendenze reali e la condivide.

Il modello dei dati unisce ciò che sa il browser e ciò che dice il server:

```ts
interface QueueItem {
  // lato browser: esiste anche prima che il server conosca il file
  localId: string;
  name: string;
  size: number;
  fileId: string | null; // assegnato dal server alla fine dell'upload
  uploadProgress: number | null;
  localError: ItemError | null; // errori del controllo preliminare o dell'upload
  abortUpload: (() => void) | null;
}

interface QueueRow {
  // ciò che i componenti mostrano
  item: QueueItem;
  server: FileSnapshot | null; // lo stato inviato dal server, se esiste
  status: ItemStatus; // 'uploading' oppure uno stato del server
  error: ItemError | null;
}
```

`rows` è un `computed` che unisce `items` e `job.files`. Le funzioni principali:

| Funzione                                    | Cosa fa                                                                                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `init()`                                    | carica `/api/config`; se `sessionStorage` contiene un job, lo ripristina (refresh della pagina) e riapre l'SSE                                 |
| `addFiles(files)`                           | `precheck()` (estensione, dimensione, numero) e accoda gli upload uno alla volta (`uploadChain`)                                               |
| `upload()`                                  | crea il job alla prima occorrenza (`ensureJob()`), carica con XHR, associa il `fileId`, rimuove eventuali righe duplicate                      |
| `applySnapshot()`                           | applica uno stato del server, **scartando quelli con `revision` più vecchia**; aggiunge i file sconosciuti solo se non ci sono upload in corso |
| `connectEvents()`                           | apre l'`EventSource`: evento `job` → `applySnapshot`, `deleted` → `handleExpired()`; su errore verifica se il job esiste ancora                |
| `start()`                                   | invia le opzioni a `/start`                                                                                                                    |
| `cancelRow()`, `removeRow()`, `cancelAll()` | annullamento dell'upload (XHR) o della conversione (API), rimozione                                                                            |
| `downloadRow()`, `downloadAll()`            | download singolo o ZIP complessivo                                                                                                             |
| `reset()`                                   | "Nuova conversione": chiude l'SSE, elimina il job sul server, svuota la coda                                                                   |

Stati derivati usati dall'interfaccia: `canStart`, `isFinished`, `readyCount`, `completedCount`,
`failedCount`, `hasPdf`, `ocrLanguagesValid`, `started`, `expired`.

### 3.4 Componenti (`src/components/`)

| Componente              | Ruolo                                                                                                                                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppHeader.vue`         | titolo, `ThemeSwitcher`, pulsante Diagnostica (`aria-expanded`, `aria-controls`)                                                                                                                                                              |
| `ThemeSwitcher.vue`     | gruppo di radio (`fieldset`/`legend`) Sistema/Chiaro/Scuro; il focus è visibile sull'etichetta                                                                                                                                                |
| `DropZone.vue`          | area di trascinamento (`dragover`/`drop`), pulsante "Scegli i file" che apre un `<input type="file" multiple>` nascosto; emette l'evento `files`                                                                                              |
| `ConversionOptions.vue` | formato di uscita, modalità, avviso sui PDF, `<details>` "Opzioni avanzate" con la gestione delle immagini                                                                                                                                    |
| `OcrOptions.vue`        | interruttore OCR (`role="switch"`), lingue (disabilitate se non installate), forza OCR, messaggio d'errore con `role="alert"`                                                                                                                 |
| `FileQueue.vue`         | titolo, riepilogo, lista `<ul>` di `FileQueueItem`                                                                                                                                                                                            |
| `FileQueueItem.vue`     | una riga: nome, dimensione, pagine, `StatusBadge`, `<progress>`, fase, errore con codice di riferimento, avvisi, suggerimento OCR, controllo preventivo degli strumenti mancanti, pulsanti Scarica/Annulla/Rimuovi con `aria-label` specifici |
| `StatusBadge.vue`       | stato con **simbolo e testo** (✓, ✕, ⟳...), non solo colore                                                                                                                                                                                   |
| `QueueActions.vue`      | Converti, Annulla tutto, Scarica tutto (ZIP), Nuova conversione, errore globale                                                                                                                                                               |
| `DiagnosticsPanel.vue`  | strumenti con versione, percorso, funzionalità, istruzioni d'installazione per sistema operativo; si chiude con Esc e riceve il focus all'apertura                                                                                            |
| `LiveAnnouncer.vue`     | due `div` `aria-live` (`polite` e `assertive`) visivamente nascosti                                                                                                                                                                           |

I componenti leggono lo stato direttamente dai composable, invece di riceverlo da `App.vue`
attraverso catene di props. `DropZone` è l'unico che emette un evento verso `App.vue`, perché è
`App.vue` a decidere cosa annunciare quando arrivano nuovi file.

### 3.5 Traduzioni (`src/i18n/`)

```ts
// it.ts
export const it = { 'queue.pages': '{count} pagine' /* ... */ } as const;

// index.ts
export type MessageKey = keyof typeof it;
export type Messages = Record<MessageKey, string>; // ogni lingua deve avere tutte le chiavi
const { t, tDynamic } = useI18n();
t('queue.pages', { count: 3 }); // "3 pagine"
tDynamic(`error.${code}`, messaggioDiRipiego); // per chiavi costruite a runtime
```

Gli errori del backend arrivano come codici e vengono tradotti con `error.<CODICE>`; se manca la
traduzione si usa il messaggio inviato dal server.

### 3.6 Stili e temi (`src/styles/main.css`)

- variabili CSS in `:root` (tema chiaro) e `:root[data-theme='dark']` (tema scuro); con
  `data-theme='system'` decide `@media (prefers-color-scheme: dark)`;
- `:focus-visible` con contorno di 3 px; classi comuni (`.button`, `.notice`, `.choice`,
  `.visually-hidden`, `.skip-link`);
- `@media (prefers-reduced-motion: reduce)` azzera animazioni e transizioni.

---

## 4. Come passa un file attraverso il codice

Esempio: `relazione.docx` convertito in PDF.

| Passo | Frontend                                                        | Backend                                                                                                                          |
| ----- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `DropZone` emette `files` → `queue.addFiles()` → `precheck()`   |                                                                                                                                  |
| 2     | `ensureJob()` → `api.createJob()`                               | `job-routes` → `JobService.createJob()` → `TempStore.createJobDirs()`                                                            |
| 3     | `connectEvents()` apre l'SSE                                    | `event-routes` invia lo stato iniziale                                                                                           |
| 4     | `uploadFile()` (XHR con avanzamento)                            | `request.file()` → `JobService.addFile()` → `saveUpload()` → `validateFileContent()` (firma ZIP + `word/document.xml`) → `ready` |
| 5     | l'utente sceglie PDF e preme Converti → `queue.start()`         | `conversionOptionsSchema.parse()` → `JobService.start()` → `queue.enqueue()`                                                     |
| 6     | eventi SSE → `applySnapshot()` → `StatusBadge` "Conversione"    | `convertFile()` → `runConversion()` → `selectPipeline()` = `docxToPdf` → `convertWithLibreOffice()` → `runProcess()`             |
| 7     | evento SSE `completed` → pulsante Scarica, annuncio `aria-live` | `setStatus('completed')` → `publish()`                                                                                           |
| 8     | `downloadRow()` → `triggerDownload()`                           | `download-routes` → stream di `result.pdf` con `Content-Disposition: relazione.pdf` → `markDownloaded()`                         |
| 9     | "Nuova conversione" → `reset()` → `api.deleteJob()`             | `destroyJob()` → `TempStore.removeJobDir()`                                                                                      |

---

## 5. Test: dove si trova cosa

| Cartella / file                                                          | Cosa verifica                                                                                                                                                                                                   |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/backend/test/helpers.ts`                                           | strumenti di supporto: `createFakeExecutor()` (imita Pandoc, LibreOffice, OCRmyPDF, anche errori e blocchi), `fakeDependencyChecker()`, `multipartPayload()`, `rawZipWithEntryName()` (ZIP con nomi pericolosi) |
| `apps/backend/test/unit/*.test.ts`                                       | un file di test per ogni area: nomi di file, percorsi, validazione, ZIP, TempStore, runner dei processi, adapter, selettore delle pipeline, stati, coda, diagnostica, Markdown, PDF                             |
| `apps/backend/test/integration/api.test.ts`                              | tutte le API con `app.inject()`: header, Host/Origin, errori, upload e limiti, ciclo di vita del job, revisione                                                                                                 |
| `apps/backend/test/integration/conversion-flow.test.ts`                  | ogni pipeline con strumenti finti: argomenti passati, OCR, errori, timeout, annullamento, pulizia                                                                                                               |
| `apps/backend/test/integration/events.test.ts`                           | SSE su una porta reale, ascolto solo su 127.0.0.1                                                                                                                                                               |
| `apps/backend/test/integration/real-tools.test.ts`                       | conversioni con gli strumenti veri; ogni test si salta da solo se lo strumento manca                                                                                                                            |
| `apps/frontend/test/queue.test.ts`                                       | `createConversionQueue()` con API, upload ed EventSource finti                                                                                                                                                  |
| `apps/frontend/test/components.test.ts`                                  | i18n, formattazione, `StatusBadge`, `DropZone`, `ThemeSwitcher`                                                                                                                                                 |
| `apps/frontend/e2e/converter.spec.ts`                                    | Playwright: flussi completi nel browser                                                                                                                                                                         |
| `tests/smoke/smoke-test.mjs`, `tests/benchmark/conversion-benchmark.mjs` | istanza in esecuzione con strumenti reali: correttezza e tempi                                                                                                                                                  |

---

## 6. Correzioni importanti e dove sono nel codice

| Problema                                                                                                             | Dove è stato corretto                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L'interfaccia restava su "Conversione": la risposta di `/start` arrivava dopo l'evento SSE finale e lo sovrascriveva | backend `job-service.ts` (`publish()` incrementa `revision`), shared `job.ts` (`JobSnapshot.revision`), frontend `useConversionQueue.ts` (`applySnapshot()` scarta le revisioni vecchie) |
| File duplicati nella coda durante l'upload                                                                           | frontend `useConversionQueue.ts`: `upload()` rimuove le righe con lo stesso `fileId`; `applySnapshot()` non aggiunge file sconosciuti con upload in corso                                |
| OCRmyPDF non trovava Tesseract installato fuori dal PATH                                                             | backend `tool-executor.ts` (`NESTED_TOOLS`) e `child-env.ts` (parametro `extraPathDirs`, una sola variabile `PATH`)                                                                      |
| Client bloccati ~30 s riusando connessioni keep-alive                                                                | backend `app.ts`: `keepAliveTimeout: 5000`                                                                                                                                               |
| Immagine prima del piè di pagina nei PDF in alta fedeltà                                                             | backend `pdf-layout.ts` (`insertImages()` dopo l'ultimo blocco sopra l'immagine) e `pdf-to-markdown.ts` (`orderPageLines()`)                                                             |
| Percorsi con `/` non abbreviati in `~` nella diagnostica                                                             | backend `dependency-checker.ts` (`displayPath()` con `path.normalize`)                                                                                                                   |

Il racconto completo, in ordine cronologico, è in [implementation-log.md](implementation-log.md).

# Architettura

Questo documento spiega **come è fatto** il convertitore e **perché** è fatto così. È pensato per
chi deve modificare il codice per la prima volta.

## Visione d'insieme

```
 Browser (Vue 3)                        Backend Node.js (Fastify)                      Strumenti locali
┌──────────────────┐   HTTP + SSE    ┌──────────────────────────────┐   spawn(args[])   ┌──────────────┐
│ DropZone         │ ──────────────▶ │ routes/  (API REST + SSE)    │ ───────────────▶  │ pandoc       │
│ Coda dei file    │ ◀────────────── │ jobs/    (job, coda, stati)  │                   │ soffice      │
│ Opzioni          │                 │ conversion/ (pipeline)       │                   │ ocrmypdf     │
│ Diagnostica      │                 │ tools/   (adapter strumenti) │                   │ tesseract    │
└──────────────────┘                 │ files/   (temp, zip, check)  │                   └──────────────┘
                                      └──────────────┬───────────────┘
                                                     │ una directory per job
                                                     ▼
                                      TEMP_DIR/job-<uuid>/{input,work,output}
```

Tutto gira su un solo computer. Il backend ascolta su `127.0.0.1`, quindi solo i programmi della
stessa macchina possono contattarlo.

In produzione il backend serve anche i file statici del frontend: un solo processo, una sola porta
(`8080`). In sviluppo Vite serve il frontend su `127.0.0.1:5173` e inoltra (proxy) le chiamate
`/api` al backend: per il browser è sempre la stessa origine, quindi non serve CORS.

## Struttura del monorepo

```
/
├── apps/
│   ├── backend/            API Fastify, job, pipeline di conversione
│   │   ├── assets/pandoc/  filtro Lua usato da Pandoc
│   │   ├── src/
│   │   │   ├── config.ts               lettura e validazione delle variabili d'ambiente
│   │   │   ├── app.ts                  costruzione dell'app Fastify (plugin, hook, route)
│   │   │   ├── index.ts                avvio, arresto controllato
│   │   │   ├── http/                   errori, header di sicurezza, controllo Host/Origin
│   │   │   ├── routes/                 un file per gruppo di endpoint
│   │   │   ├── jobs/                   job store, macchina a stati, coda, eventi
│   │   │   ├── files/                  directory temporanee, validazione, nomi, ZIP
│   │   │   ├── process/                esecuzione sicura dei processi esterni
│   │   │   ├── tools/                  adapter: pandoc, libreoffice, ocrmypdf, tesseract
│   │   │   ├── diagnostics/            rilevamento delle dipendenze
│   │   │   └── conversion/             selezione pipeline, pipeline, PDF, immagini Markdown
│   │   └── test/                       unit e integration test (Vitest)
│   └── frontend/           Vue 3 + Vite
│       ├── src/
│       │   ├── api/                    client HTTP tipizzato
│       │   ├── components/             componenti piccoli, uno per responsabilità
│       │   ├── composables/            stato della coda, tema, i18n
│       │   ├── i18n/                   dizionari delle lingue (it.ts)
│       │   └── styles/                 variabili CSS e temi
│       └── e2e/                        test Playwright
├── packages/
│   └── shared/             tipi TypeScript e costanti condivise (nessuna dipendenza runtime)
├── tests/
│   ├── fixtures/           documenti di prova generati da script, senza dati reali
│   └── smoke/              smoke test contro un'istanza reale (Docker)
├── docker/                 Dockerfile e script di supporto
├── docs/                   questa documentazione
├── docker-compose.yml
└── .env.example
```

`packages/shared` contiene solo **tipi e costanti** (formati, stati, codici di errore). Non importa
librerie, così il frontend non si porta dietro codice del backend. Il backend valida i dati con Zod
e verifica, tramite `satisfies`, che gli schemi corrispondano ai tipi condivisi.

Le dipendenze vanno in una sola direzione: `frontend → shared`, `backend → shared`. `shared` non
importa niente.

## Flusso completo di una conversione

1. **Creazione del job.** Quando l'utente aggiunge il primo file, il frontend chiama
   `POST /api/jobs`. Il backend genera un ID casuale (`crypto.randomUUID()`), crea
   `TEMP_DIR/job-<uuid>/` e restituisce lo stato del job. L'ID viene salvato in `sessionStorage`
   per sopravvivere a un refresh della pagina.
2. **Upload.** Ogni file è inviato con `POST /api/jobs/:jobId/files` (multipart, un file per
   richiesta). Il backend scrive il flusso **direttamente su disco** (streaming: il file non viene
   mai tenuto tutto in memoria) con un nome interno casuale, interrompendo l'upload se supera
   `MAX_FILE_SIZE_MB` o il totale `MAX_TOTAL_SIZE_MB`.
3. **Validazione** (stato `validating`). Estensione → MIME dichiarato → firma (magic bytes) →
   controllo di struttura (DOCX: voci obbligatorie e limiti anti zip-bomb; PDF: apertura con
   pdf.js e conteggio del testo). Se il PDF ha poco testo, il file riceve `ocrSuggested: true` e
   l'interfaccia mostra il suggerimento. Esito: `ready` oppure `failed`.
4. **Avvio.** L'utente sceglie formato di uscita e opzioni e preme "Converti": `POST
/api/jobs/:jobId/start`. Le opzioni vengono validate con Zod; i file `ready` passano a `queued`.
5. **Coda.** `ConversionQueue` esegue al massimo `MAX_CONCURRENT_JOBS` conversioni insieme. Ogni
   file ha un `AbortController`: annullare significa chiamare `abort()`, che termina anche i
   processi figli.
6. **Pipeline** (stato `converting`). `selectPipeline(input, output, mode)` restituisce la funzione
   giusta (vedi [conversion-matrix.md](conversion-matrix.md)). La pipeline lavora in
   `job-<uuid>/work/<fileId>/` e scrive il risultato in `job-<uuid>/output/<fileId>/`. I processi
   esterni sono eseguiti da `runProcess()` con argomenti in array, timeout e limiti di output.
7. **Aggiornamenti.** Ogni cambio di stato emette un evento: il frontend lo riceve tramite
   **Server-Sent Events** (`GET /api/jobs/:jobId/events`). SSE è una connessione HTTP che resta
   aperta e su cui il server scrive messaggi di testo; il browser la riapre da solo se cade.
8. **Download.** `GET /api/jobs/:jobId/files/:fileId/download` invia il singolo risultato in
   streaming; `GET /api/jobs/:jobId/archive` crea al volo uno ZIP con tutti i risultati e un
   `report.json` (successi ed errori, senza dati sensibili).
9. **Pulizia.** La directory del job viene eliminata: su richiesta (`DELETE /api/jobs/:jobId`),
   `CLEANUP_AFTER_DOWNLOAD_SECONDS` dopo che tutti i risultati sono stati scaricati, alla scadenza
   del TTL di inattività, all'arresto del server e, all'avvio, se orfana e più vecchia del TTL.

## Stati di un file

```
validating ──▶ ready ──▶ queued ──▶ converting ──▶ completed
     │           │          │            │
     └──▶ failed └──────────┴────────────┴──▶ cancelled / failed
```

| Stato        | Etichetta UI | Significato                                         |
| ------------ | ------------ | --------------------------------------------------- |
| `validating` | Validazione  | il file è stato ricevuto e viene controllato        |
| `ready`      | Pronto       | valido, in attesa che l'utente avvii la conversione |
| `queued`     | In attesa    | in coda, aspetta uno slot libero                    |
| `converting` | Conversione  | pipeline in esecuzione                              |
| `completed`  | Completato   | risultato disponibile per il download               |
| `cancelled`  | Annullato    | annullato dall'utente                               |
| `failed`     | Errore       | errore con codice stabile e messaggio comprensibile |

Le transizioni ammesse sono definite in un solo punto: `apps/backend/src/jobs/file-state.ts`.
Una transizione non ammessa genera un errore di programmazione (non un errore utente), così i bug
emergono nei test.

Lo stato del job è **in memoria**: se il backend si riavvia i job in corso si perdono e le loro
directory vengono rimosse dalla pulizia. È una scelta voluta per un'app monoutente locale: evita un
database e non lascia tracce dei documenti.

## API

Tutte le risposte sono JSON, tranne download e SSE. Gli errori hanno sempre questa forma:

```json
{
  "error": {
    "code": "FILE_TOO_LARGE",
    "message": "Il file supera la dimensione massima consentita.",
    "details": "Limite: 50 MB.",
    "correlationId": "8d3c5c1e-..."
  }
}
```

| Metodo e percorso                             | Scopo                                    | Codici                  |
| --------------------------------------------- | ---------------------------------------- | ----------------------- |
| `GET /api/health`                             | il servizio è vivo                       | 200                     |
| `GET /api/config`                             | limiti e opzioni pubbliche per la UI     | 200                     |
| `GET /api/diagnostics[?refresh=true]`         | disponibilità di Pandoc, LibreOffice...  | 200                     |
| `POST /api/jobs`                              | crea un job vuoto                        | 201, 503                |
| `GET /api/jobs/:jobId`                        | stato del job (anche dopo un refresh)    | 200, 404                |
| `POST /api/jobs/:jobId/files`                 | carica un file (multipart, campo `file`) | 201, 400, 409, 413, 415 |
| `DELETE /api/jobs/:jobId/files/:fileId`       | rimuove un file (annulla se in corso)    | 204, 404                |
| `POST /api/jobs/:jobId/start`                 | avvia la conversione con le opzioni      | 202, 400, 409           |
| `POST /api/jobs/:jobId/cancel`                | annulla tutti i file non conclusi        | 202, 404                |
| `POST /api/jobs/:jobId/files/:fileId/cancel`  | annulla un singolo file                  | 202, 404, 409           |
| `GET /api/jobs/:jobId/events`                 | flusso SSE con lo stato aggiornato       | 200, 404                |
| `GET /api/jobs/:jobId/files/:fileId/download` | scarica un risultato                     | 200, 404, 409           |
| `GET /api/jobs/:jobId/archive`                | ZIP con tutti i risultati + report       | 200, 404, 409           |
| `DELETE /api/jobs/:jobId`                     | elimina job e file temporanei            | 204, 404                |

Ogni risposta contiene l'header `X-Correlation-Id`. Lo stesso ID compare nei log del server e nel
corpo degli errori: chi segnala un problema può fornirlo senza mostrare il documento.

Nessuna risposta contiene percorsi del filesystem: i file sono identificati solo da UUID.

I codici di errore stabili sono elencati in `packages/shared/src/errors.ts` e in
[security.md](security.md#codici-di-errore).

## Scelte tecniche

### Fastify invece di Express

- validazione e serializzazione integrate e veloci;
- supporto nativo a `async/await` e gestione centralizzata degli errori (`setErrorHandler`);
- `@fastify/multipart` legge gli upload **in streaming** con limiti di dimensione;
- `app.inject()` permette di testare le API senza aprire porte di rete;
- tipizzazione TypeScript curata dal progetto stesso.

Express è più conosciuto ma richiede più middleware di terze parti per ottenere lo stesso risultato.

### Niente Pinia

Lo stato condiviso dell'interfaccia è uno solo (la coda del job corrente). Un composable
(`useConversionQueue`) con stato reattivo a livello di modulo basta ed è più semplice da leggere.
Se in futuro ci saranno più "store" indipendenti, Pinia diventerà utile.

### i18n senza libreria

Le stringhe sono in `apps/frontend/src/i18n/it.ts`. Il composable `useI18n()` espone `t(chiave,
parametri)`. I tipi TypeScript garantiscono che ogni lingua abbia tutte le chiavi: aggiungere una
lingua significa aggiungere un file, senza toccare i componenti. Una libreria come `vue-i18n`
sarebbe giustificata con pluralizzazione complessa o molte lingue.

### SSE invece di WebSocket

Gli aggiornamenti vanno in una sola direzione (server → browser). SSE usa HTTP normale, si
riconnette da solo e non richiede librerie. WebSocket non darebbe vantaggi concreti.

### Stato in memoria, file su disco

I file non stanno mai interamente in memoria durante upload e download (streaming). Fa eccezione
l'analisi PDF: pdf.js deve leggere tutto il documento, motivo per cui `MAX_FILE_SIZE_MB` ha un
valore prudente (50 MB).

## Dipendenze e motivazioni

### Backend (runtime)

| Pacchetto            | Motivo                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `fastify`            | server HTTP (vedi sopra)                                                                       |
| `@fastify/multipart` | upload in streaming con limiti                                                                 |
| `@fastify/static`    | serve il frontend compilato in produzione                                                      |
| `zod`                | validazione di variabili d'ambiente e corpo delle richieste                                    |
| `pdfjs-dist`         | analisi PDF: testo con posizione e font, link, immagini (Mozilla, Apache-2.0)                  |
| `pngjs`              | codifica in PNG delle immagini estratte dai PDF (pure JS, MIT)                                 |
| `yazl`               | scrittura ZIP in streaming (risultati, archivio complessivo)                                   |
| `yauzl`              | lettura ZIP voce per voce: ispezione DOCX e pacchetti Markdown senza estrarre tutto in memoria |

`yazl` e `yauzl` sono dello stesso autore, piccoli e senza dipendenze native. Non serve un pacchetto
per il logging: Fastify include `pino`.

### Backend (sviluppo)

`typescript`, `tsx` (esecuzione TypeScript in sviluppo), `vitest` (test), tipi `@types/*`.

### Frontend

| Pacchetto                    | Motivo                              |
| ---------------------------- | ----------------------------------- |
| `vue`                        | framework UI richiesto              |
| `vite`, `@vitejs/plugin-vue` | build e server di sviluppo          |
| `vue-tsc`                    | type checking dei file `.vue`       |
| `@vue/test-utils`, `jsdom`   | unit test dei componenti            |
| `@playwright/test`           | test end-to-end in un browser reale |

Nessuna libreria UI: i componenti necessari (pulsanti, interruttori, liste) sono semplici e con
CSS moderno si controllano meglio accessibilità e contrasto.

### Strumenti di sistema

| Strumento     | Usato per                                     | Obbligatorio?                  |
| ------------- | --------------------------------------------- | ------------------------------ |
| Pandoc ≥ 2.15 | Markdown ↔ DOCX, PDF → DOCX semplice          | sì per le conversioni indicate |
| LibreOffice   | DOCX → PDF, MD → PDF, PDF → DOCX alta fedeltà | sì per le conversioni indicate |
| OCRmyPDF      | OCR dei PDF                                   | solo con OCR                   |
| Tesseract     | motore OCR usato da OCRmyPDF, elenco lingue   | solo con OCR                   |

Pandoc ≥ 2.15 è richiesto per l'opzione `--sandbox`.

## Come aggiungere una nuova conversione

1. Aggiungi il formato (se nuovo) in `packages/shared/src/formats.ts`.
2. Scrivi la pipeline in `apps/backend/src/conversion/pipelines/<da>-to-<a>.ts`: una funzione
   `(context: PipelineContext) => Promise<PipelineResult>`.
3. Registrala in `apps/backend/src/conversion/pipeline-selector.ts` indicando gli strumenti
   richiesti.
4. Aggiungi un test in `apps/backend/test/unit/jobs-core.test.ts` (selezione della pipeline) e un
   test della pipeline con un `ToolExecutor` finto (vedi `test/integration/conversion-flow.test.ts`).
5. Aggiorna [conversion-matrix.md](conversion-matrix.md).

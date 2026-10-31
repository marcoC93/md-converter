# Registro di implementazione

Decisioni importanti, problemi incontrati e soluzioni, in ordine cronologico.

## Fase 1 — Analisi

**Ambiente di sviluppo disponibile (Windows 11, 2026-10-31):** Node.js 26.6, npm 11. Non
installati: pnpm, Pandoc, LibreOffice, Tesseract, OCRmyPDF, Docker. pnpm 10 installato con
`npm i -g pnpm@10` (Corepack non è più incluso in Node ≥ 25).

**Verifica del comportamento di Pandoc.** Per controllare le ipotesi è stato scaricato il pacchetto
portabile ufficiale di Pandoc 3.13 in una directory temporanea esterna al progetto (non installato
nel sistema). Risultati:

- `--sandbox` blocca immagini remote (`https://...`) e relative (`img/a.png`) con un avviso, senza
  fallire;
- `--sandbox` accetta immagini `data:image/...;base64,...`;
- `--extract-media` funziona anche in sandbox.

**Decisione:** Pandoc gira sempre con `--sandbox`. Per i pacchetti `.zip` Markdown il backend
legge le immagini locali (dopo averne verificato il percorso) e le trasforma in data URI prima di
chiamare Pandoc. Così nessun documento può far scaricare risorse da Internet.

**Decisione:** Markdown → PDF passa da DOCX + LibreOffice invece di LaTeX (vedi
`conversion-matrix.md`).

**Decisione:** PDF → Markdown usa pdf.js invece di Poppler o librerie Python (confronto in
`conversion-matrix.md`).

**Decisione:** TypeScript 6.0 invece della 7.0: `typescript-eslint` 8.x supporta TypeScript
`<6.1`.

**Rischi individuati**

- PDF → DOCX/Markdown non può essere fedele per tabelle e layout a più colonne: documentato e
  mostrato nell'interfaccia.
- OCRmyPDF su Windows richiede Python, Ghostscript e Tesseract: documentato l'uso di Docker/WSL2.
- `soffice --version` su Windows non scrive sulla console: il rilevamento preferisce `soffice.com`.
- Docker non è disponibile in questo ambiente: Dockerfile e smoke test sono preparati ma non
  eseguiti qui (vedi sezione Fase 6).

## Fase 2 — Scaffolding

- Monorepo pnpm con `apps/backend`, `apps/frontend`, `packages/shared`. ESM ovunque.
- `packages/shared` contiene solo tipi e costanti, compilato in `dist/` con `tsc`: il backend lo
  usa a runtime, il frontend lo importa tramite Vite. Gli schemi Zod restano nel backend per non
  includere Zod nel bundle del frontend; `satisfies z.ZodType<ConversionOptions>` garantisce la
  coerenza con i tipi condivisi.
- TypeScript 6 strict con `noUncheckedIndexedAccess`. Con TypeScript 6 l'opzione `types` va
  dichiarata esplicitamente (`["node"]`, `["vite/client"]`).

## Fase 3 — Backend

- Fastify 5 + `@fastify/multipart` (streaming) + `@fastify/static`. Header di sicurezza e
  controllo Host/Origin implementati come hook (nessuna dipendenza in più).
- **Problema:** Fastify 5.12 segnala come deprecata l'opzione `disableRequestLogging`.
  **Soluzione:** `logController: new LogController({ disableRequestLogging: true })`.
- **Problema:** pdf.js 6 non ha più `PDFDocumentProxy.destroy()` né l'opzione `isEvalSupported`.
  **Soluzione:** la memoria si libera con `loadingTask.destroy()` (funzione `close()` restituita
  da `openPdf`).
- **Problema:** l'header `Host` originale serve al controllo anti-CSRF. **Soluzione:** nel proxy di
  Vite `changeOrigin: false`, così `Host` e `Origin` restano coerenti (`127.0.0.1:5173`).

## Fase 4 — Motore di conversione

- Adapter separati in `src/tools/` (pandoc, libreoffice, ocrmypdf, tesseract) con funzioni pure
  che costruiscono gli argomenti, testate singolarmente.
- PDF → Markdown: euristiche su dimensione del carattere (titoli), simboli iniziali (elenchi),
  distanza verticale (paragrafi), righe ripetute in alto/basso (intestazioni), annotazioni Link
  (collegamenti), matrice di trasformazione (posizione delle immagini).
- **Problema:** in alta fedeltà l'immagine veniva inserita prima del piè di pagina "Pagina 1",
  perché nel flusso del PDF il piè di pagina compare prima del corpo. **Soluzione:** le immagini
  vengono inserite dopo l'ultimo blocco che si trova _sopra_ di esse, e in alta fedeltà
  intestazioni e piè di pagina vengono spostati all'inizio e alla fine della pagina.
- Filtro Lua `simplify-markdown.lua` per la modalità semplice DOCX → Markdown: senza di esso
  Pandoc scrive in HTML (`<figure>`, `<img width=...>`) le immagini con attributi e didascalie.
- Verifica con Pandoc reale (3.13): MD → DOCX, pacchetto ZIP → DOCX, DOCX → MD (images/ e
  Base64), PDF → DOCX semplice. LibreOffice e OCRmyPDF non verificati localmente (non installati).

## Fase 5 — Frontend

- Vue 3 + Composition API, nessuna libreria UI, nessuna Pinia (vedi `architecture.md`).
- Upload con `XMLHttpRequest` per avere l'avanzamento reale; stato dal server via SSE.
- **Problema trovato provando l'interfaccia:** un file compariva due volte nella coda perché
  l'evento SSE arrivava prima della risposta dell'upload. **Soluzione:** durante gli upload i file
  sconosciuti non vengono aggiunti dal flusso SSE, e a fine upload eventuali duplicati vengono
  rimossi. Test di regressione in `apps/frontend/test/queue.test.ts`.
- Script del tema in `public/theme-init.js` (non inline) per rispettare la CSP.

## Fase 6 — Docker

- Immagine `node:24.19.0-trixie-slim` (tag verificato su Docker Hub), build multi-stage, utente
  `node`, `read_only`, `tmpfs` per `/tmp`, `cap_drop: ALL`, porta pubblicata su `127.0.0.1`.
- **Non verificato:** Docker non è installato in questo ambiente, quindi build dell'immagine,
  avvio del container e smoke test in Docker **non sono stati eseguiti**. In particolare restano
  da confermare: nomi dei pacchetti Debian (`libreoffice-writer-nogui`, `libreoffice-draw-nogui`),
  funzionamento di LibreOffice con filesystem in sola lettura e `HOME` nel tmpfs, OCR reale.
- Lo smoke test (`tests/smoke/smoke-test.mjs`) è stato eseguito contro l'istanza **nativa**
  (Windows, solo Pandoc disponibile) con `--allow-missing`: 6 conversioni superate, 4 saltate.

## Fase 7 — End-to-end e sicurezza

- Playwright: 9 test superati su Chromium (caricamento, drag-and-drop, multiplo, errore,
  rimozione, download singolo e ZIP, tema, tastiera, nessuna richiesta esterna).
- **Problema:** durante lo smoke test ogni conversione impiegava ~30 s pur essendo completata dal
  server in meno di 100 ms. Analisi: con il `keepAliveTimeout` predefinito di Fastify (72 s), una
  connessione keep-alive riusata dal client `fetch` di Node dopo ≥ 500 ms di inattività restava
  bloccata ~30 s; riprodotto con un'app Fastify minima e non con un server `http` di Node puro
  (timeout 5 s). Probabile interazione con un software di rete/sicurezza dell'ambiente Windows.
  **Soluzione:** `keepAliveTimeout: 5000` (il default di Node). Dopo la correzione: ~3 s per
  conversione (tempo di avvio di Pandoc su Windows).
- **Problema:** il percorso `C:/Users/...` (barre normali) non veniva abbreviato in `~` nella
  diagnostica. **Soluzione:** normalizzazione con `path.normalize` prima del confronto.
- **Problema:** un test sul timeout dei processi falliva saltuariamente sotto carico (asserzione
  sul tempo trascorso < 8 s). **Soluzione:** l'asserzione era ridondante (senza kill il test
  andrebbe comunque in timeout) ed è stata rimossa; nessun controllo disabilitato.
- Verifiche manuali: Host estraneo → 403, Origin estranea → 403, nome `../../etc/passwd.md` →
  salvato con UUID e mostrato come `passwd.md`, `fake.pdf` → 415 `INVALID_FILE_CONTENT`, nessun
  riferimento a host esterni nel bundle del frontend (solo namespace XML e URL di documentazione
  di Vue, mai richiesti).

## Correzione — conversione che "non termina" nell'interfaccia (2026-10-31)

- **Sintomo:** con `text.pdf` e uscita Word (Pandoc non installato) l'interfaccia restava su
  "Conversione" per sempre, anche se il server aveva già segnato il file come fallito.
- **Benchmark** (`pnpm bench`): lato server nessuna conversione si blocca. PDF → Markdown richiede
  25–80 ms (dai log del server); i casi senza strumento falliscono in pochi millisecondi.
- **Causa:** la risposta di `POST /start` contiene lo stato preso mentre il file era ancora
  `converting`. Quando la conversione fallisce subito, l'evento SSE `failed` arriva al browser
  _prima_ di quella risposta, che poi lo sovrascrive con lo stato vecchio; nessun altro evento
  arriva più e la riga resta bloccata.
- **Soluzione:** `JobSnapshot.revision`, incrementata dal backend a ogni modifica pubblicata; il
  frontend scarta gli stati con revisione inferiore a quella già mostrata. Test di regressione in
  `apps/frontend/test/queue.test.ts` (fallisce senza la correzione) e
  `apps/backend/test/integration/api.test.ts`.
- **Nota sui tempi misurati dal client:** su questa macchina le richieste HTTP locali mostrano
  spesso ~450 ms di latenza aggiuntiva, indipendente dalla conversione (vedi la sezione Fase 7).

## Installazione degli strumenti mancanti su Windows senza amministratore (2026-10-31)

- Installati per l'utente corrente: Pandoc 3.13 (`winget --scope user`), LibreOffice 26.8.2.2
  (MSI estratto con `msiexec /a`), Tesseract 5.4.0 (installer estratto con 7-Zip, lingua `ita`
  aggiunta da `tesseract-ocr/tessdata_fast`), OCRmyPDF 17.13 (`pip install --user`, usa pypdfium2,
  senza Ghostscript). Procedura in `install-windows.md`, sezione 5-bis.
- **Problema:** OCRmyPDF avvia `tesseract` cercandolo nel PATH, ma il backend passa ai processi
  figli il PATH di sistema, dove Tesseract non c'è. **Soluzione:** `createToolExecutor` mette in
  testa al PATH dei processi figli la cartella del Tesseract rilevato. Inoltre `buildChildEnv`
  passa una sola variabile `PATH`, invece di `PATH` e `Path` insieme come succedeva su Windows.
- **Problema:** il test reale dell'OCR cercava il testo nel risultato ZIP (immagini separate),
  quindi falliva anche quando l'OCR funzionava. **Soluzione:** il test e lo smoke test usano le
  immagini incorporate (un `.md` leggibile) e verificano "DI PROVA". Il font a blocchi della
  fixture fa leggere "SCAMSIONE" invece di "SCANSIONE".
- **Verifica:** `pnpm smoke` 10/10 con gli strumenti reali, test `real-tools` 10/10.
  LibreOffice impiega 33–80 s per conversione (vedi `known-limitations.md`).

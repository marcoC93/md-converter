# Convertitore documenti locale

Web application **locale e offline** per convertire documenti tra **Markdown**, **Word (DOCX)** e
**PDF**. Tutto avviene sul tuo computer: nessun documento viene inviato in rete, nessuna
telemetria, nessuna risorsa esterna.

| Da \ A       | Markdown       | DOCX                          | PDF                  |
| ------------ | -------------- | ----------------------------- | -------------------- |
| **Markdown** | —              | Pandoc                        | Pandoc + LibreOffice |
| **DOCX**     | Pandoc         | —                             | LibreOffice          |
| **PDF**      | pdf.js (+ OCR) | pdf.js + Pandoc / LibreOffice | —                    |

Funzionalità principali: conversione singola e batch, drag-and-drop, download singolo o ZIP
complessivo con report, OCR opzionale per PDF scansionati (italiano e inglese), modalità
semplice o alta fedeltà, immagini Markdown in cartella `images/` o incorporate in Base64, tema
chiaro/scuro/di sistema, pannello diagnostico, interfaccia accessibile (WCAG 2.2 AA) in italiano.

> **Limite importante.** Un PDF descrive soprattutto l'aspetto delle pagine, non la struttura del
> documento. PDF → Markdown/DOCX deduce titoli, paragrafi ed elenchi, ma tabelle e layout a più
> colonne non vengono ricostruiti. Vedi [Limiti noti](docs/known-limitations.md).

## Indice

- [Guida rapida](#guida-rapida)
- [Prima conversione di prova](#prima-conversione-di-prova)
- [Privacy e rete](#privacy-e-rete)
- [Struttura del progetto](#struttura-del-progetto)
- [Script disponibili](#script-disponibili)
- [Configurazione](#configurazione)
- [Documentazione](#documentazione)

## Guida rapida

### Opzione A — Docker (consigliata: include tutti gli strumenti, OCR compreso)

Requisiti: Docker Desktop (Windows/macOS) o Docker Engine + plugin Compose (Linux).

```bash
docker compose up -d --build
```

Apri <http://127.0.0.1:8080>. Il primo build scarica Node, Pandoc, LibreOffice e Tesseract
(stima: circa 1 GB, alcuni minuti). Per fermare:

```bash
docker compose down
```

Dettagli, note per Windows/WSL2 e macOS: [docs/docker.md](docs/docker.md).

### Opzione B — Installazione nativa

Requisiti: **Node.js ≥ 22.13** e **pnpm 10**. Gli strumenti di conversione sono facoltativi:
ogni conversione richiede solo i suoi (vedi tabella sopra). PDF → Markdown funziona anche senza
nessuno strumento esterno.

Guide passo passo: [Windows](docs/install-windows.md) · [macOS](docs/install-macos.md) ·
[Linux (Debian/Ubuntu)](docs/install-linux.md).

```bash
npm install -g pnpm@10
```

```bash
pnpm install
```

```bash
pnpm build
```

```bash
pnpm start
```

Apri <http://127.0.0.1:8080>. Per controllare quali strumenti sono stati trovati:

```bash
pnpm diagnose
```

### Modalità sviluppo

```bash
pnpm dev
```

Avvia il backend con ricaricamento automatico su `127.0.0.1:8080` e Vite su
<http://127.0.0.1:5173> (le chiamate `/api` vengono inoltrate al backend).

## Prima conversione di prova

1. Avvia l'app (Docker o `pnpm start`) e apri <http://127.0.0.1:8080>.
2. Premi **Diagnostica** in alto a destra: controlla quali strumenti risultano disponibili.
3. Trascina nell'area tratteggiata il file `tests/fixtures/files/text.pdf` (oppure premi
   **Scegli i file**).
4. Nel pannello **Opzioni di conversione** scegli **Markdown (.md)**.
5. Premi **Converti**. Lo stato passa da _In attesa_ a _Conversione_ a _Completato_.
6. Premi **Scarica**: ottieni `text.zip` con `text.md` e la cartella `images/`.
7. Prova anche `simple.md` → Word e `simple.docx` → Markdown (servono Pandoc) o → PDF (serve
   LibreOffice). I file di prova si rigenerano con `pnpm fixtures`.

Che cosa succede dietro le quinte, passo per passo, è descritto in
[docs/architecture.md](docs/architecture.md#flusso-completo-di-una-conversione).

## Privacy e rete

**Modello di privacy**

- Il backend ascolta solo su `127.0.0.1` (loopback): è raggiungibile **solo da programmi dello
  stesso computer**. Altri dispositivi della rete (LAN, Wi-Fi) non possono collegarsi.
- In Docker la porta è pubblicata solo su `127.0.0.1` dell'host (`127.0.0.1:8080:8080`).
- I documenti restano in una directory temporanea per job (`TEMP_DIR/job-<id casuale>/`) e
  vengono cancellati dopo il download, alla scadenza (60 minuti di inattività), dopo errori e
  all'arresto. In Docker la directory è in RAM (`tmpfs`).
- Nessuna telemetria, analytics, CDN, font o script esterni. La Content-Security-Policy impedisce
  al browser di caricare risorse da altri siti.
- Pandoc gira con `--sandbox`: un Markdown che contiene immagini remote non provoca download
  (le immagini vengono saltate con un avviso).
- I log non contengono il contenuto né il nome dei documenti, solo identificatori casuali, durate
  e codici di errore.
- Il backend rifiuta richieste con header `Host` estranei (protezione da DNS rebinding) e richieste
  di modifica provenienti da altre origini (protezione CSRF): un sito web aperto nel browser non
  può usare il convertitore al posto tuo.

**Cosa succede se cambi `HOST` da `127.0.0.1` a `0.0.0.0`**

`0.0.0.0` significa "tutte le interfacce di rete". Il servizio diventerebbe raggiungibile da
**chiunque sulla stessa rete** (colleghi, ospiti del Wi-Fi, altri dispositivi), **senza login**:
potrebbero caricare documenti, consumare CPU e scaricare i risultati dei job di cui conoscono
l'ID. Per questo il backend si rifiuta di partire con un host non di loopback se non imposti
anche `ALLOW_NON_LOOPBACK=true`, e anche allora accetta solo gli header `Host` elencati in
`ALLOWED_HOSTS`. Non farlo su reti condivise. Lo stesso vale per Docker: scrivere `8080:8080`
invece di `127.0.0.1:8080:8080` pubblica la porta su tutte le interfacce dell'host.

Dettagli tecnici: [docs/security.md](docs/security.md) e [SECURITY.md](SECURITY.md).

## Struttura del progetto

```
.
├── apps/
│   ├── backend/        API Fastify + pipeline di conversione (TypeScript)
│   └── frontend/       interfaccia Vue 3 + Vite (TypeScript)
├── packages/shared/    tipi e costanti condivisi tra frontend e backend
├── tests/
│   ├── fixtures/       documenti di prova inventati e lo script che li genera
│   └── smoke/          smoke test contro un'istanza reale (Docker o nativa)
├── docker/             Dockerfile e health check
├── docs/               documentazione tecnica
├── docker-compose.yml
├── .env.example        tutte le variabili di configurazione, con i valori predefiniti
└── SECURITY.md
```

È un monorepo **pnpm workspace**: un solo `pnpm install` alla radice installa tutto, e i
pacchetti si richiamano per nome (`@md-converter/shared`). Spiegazione dettagliata di ogni
cartella: [docs/architecture.md](docs/architecture.md#struttura-del-monorepo).

## Script disponibili

| Comando          | Cosa fa                                                              |
| ---------------- | -------------------------------------------------------------------- |
| `pnpm dev`       | backend e frontend in sviluppo con ricaricamento automatico          |
| `pnpm build`     | compila shared, backend e frontend                                   |
| `pnpm start`     | avvia il backend compilato (serve anche il frontend) leggendo `.env` |
| `pnpm diagnose`  | stampa lo stato di Pandoc, LibreOffice, Tesseract, OCRmyPDF          |
| `pnpm lint`      | ESLint su tutto il repository                                        |
| `pnpm format`    | formatta il codice con Prettier (`format:check` per solo controllo)  |
| `pnpm typecheck` | controllo dei tipi TypeScript (strict) e dei componenti Vue          |
| `pnpm test`      | unit e integration test (Vitest)                                     |
| `pnpm test:e2e`  | test end-to-end Playwright (richiede `pnpm build` prima)             |
| `pnpm smoke`     | smoke test contro un'istanza in esecuzione, con gli strumenti reali  |
| `pnpm fixtures`  | rigenera i documenti di prova                                        |
| `pnpm check`     | lint + format + typecheck + test + build in sequenza                 |

Come sono organizzati i test e cosa coprono: [docs/testing.md](docs/testing.md).

## Configurazione

Copia `.env.example` in `.env` e modifica solo ciò che ti serve: ogni variabile è commentata e ha
un valore predefinito prudente. Le più utili:

| Variabile                              | Predefinito | Significato                                    |
| -------------------------------------- | ----------- | ---------------------------------------------- |
| `PORT`                                 | `8080`      | porta HTTP                                     |
| `MAX_FILE_SIZE_MB`                     | `50`        | dimensione massima di un file                  |
| `MAX_FILES_PER_JOB`                    | `20`        | file per conversione                           |
| `MAX_CONCURRENT_JOBS`                  | `2`         | conversioni in parallelo                       |
| `CONVERSION_TIMEOUT_SECONDS`           | `300`       | tempo massimo per file                         |
| `OCR_LANGUAGES`                        | `ita,eng`   | lingue OCR selezionabili                       |
| `PANDOC_PATH`, `LIBREOFFICE_PATH`, ... | vuoto       | percorso degli strumenti, se non sono nel PATH |

## Documentazione

| Documento                                                | Contenuto                                                                     |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [docs/architecture.md](docs/architecture.md)             | architettura, flusso di una conversione, API, scelte tecniche, dipendenze     |
| [docs/code-guide.md](docs/code-guide.md)                 | guida al codice: moduli e funzioni di backend, frontend e pacchetto condiviso |
| [docs/conversion-matrix.md](docs/conversion-matrix.md)   | pipeline per ogni coppia di formati, modalità, fedeltà                        |
| [docs/security.md](docs/security.md)                     | minacce, contromisure, codici di errore                                       |
| [docs/docker.md](docs/docker.md)                         | Docker Compose, Docker Desktop, WSL2, ciclo di vita dei file                  |
| [docs/install-windows.md](docs/install-windows.md)       | installazione nativa su Windows                                               |
| [docs/install-macos.md](docs/install-macos.md)           | installazione nativa su macOS (Homebrew)                                      |
| [docs/install-linux.md](docs/install-linux.md)           | installazione nativa su Debian/Ubuntu                                         |
| [docs/troubleshooting.md](docs/troubleshooting.md)       | problemi frequenti e soluzioni                                                |
| [docs/testing.md](docs/testing.md)                       | test unitari, di integrazione, E2E e smoke                                    |
| [docs/extending.md](docs/extending.md)                   | nuova conversione, nuova lingua OCR, nuova lingua dell'interfaccia            |
| [docs/known-limitations.md](docs/known-limitations.md)   | limiti noti                                                                   |
| [docs/implementation-log.md](docs/implementation-log.md) | decisioni e problemi incontrati durante lo sviluppo                           |

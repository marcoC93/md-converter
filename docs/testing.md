# Test

| Livello                 | Strumento                       | Dove                                               | Comando         | Richiede strumenti esterni?                          |
| ----------------------- | ------------------------------- | -------------------------------------------------- | --------------- | ---------------------------------------------------- |
| Unit (backend)          | Vitest                          | `apps/backend/test/unit/`                          | `pnpm test`     | no                                                   |
| Integration (backend)   | Vitest                          | `apps/backend/test/integration/`                   | `pnpm test`     | no (adapter finti)                                   |
| Strumenti reali         | Vitest                          | `apps/backend/test/integration/real-tools.test.ts` | `pnpm test`     | sì: ogni test si salta da solo se manca lo strumento |
| Unit (frontend, shared) | Vitest + Vue Test Utils + jsdom | `apps/frontend/test/`, `packages/shared/test/`     | `pnpm test`     | no                                                   |
| End-to-end              | Playwright (Chromium)           | `apps/frontend/e2e/`                               | `pnpm test:e2e` | no (usa PDF → Markdown, che è JavaScript puro)       |
| Smoke                   | script Node                     | `tests/smoke/smoke-test.mjs`                       | `pnpm smoke`    | sì (pensato per Docker)                              |

## Come funzionano i test senza Pandoc e LibreOffice

Le pipeline non avviano direttamente i processi: ricevono un `ToolExecutor`, una funzione che
esegue uno strumento. In produzione è `createToolExecutor()` (avvia il processo vero con
`runProcess`); nei test è `createFakeExecutor()` in `apps/backend/test/helpers.ts`, che:

- registra gli argomenti di ogni chiamata (per verificare `--sandbox`, `--skip-text`, ecc.);
- scrive file di output finti come farebbe lo strumento vero;
- può simulare un errore (`'fail'`) o un processo bloccato (`'hang'`) per testare errori,
  timeout e annullamento.

Il `ProcessRunner` stesso (timeout, kill dell'albero di processi, limiti di output, assenza di
shell) è testato con processi reali: usa Node.js come "programma esterno".

## Test con gli strumenti reali in locale

Se gli strumenti sono installati e nel PATH, `pnpm test` li usa automaticamente. Per indicare un
percorso diverso:

```bash
PANDOC_PATH=/percorso/pandoc pnpm --filter @md-converter/backend exec vitest run real-tools
```

L'output mostra quali test sono stati saltati e perché (es. `strumento non disponibile per:
DOCX → PDF`).

## End-to-end

La prima volta installa il browser:

```bash
pnpm --filter @md-converter/frontend exec playwright install chromium
```

Poi:

```bash
pnpm build
```

```bash
pnpm test:e2e
```

Playwright avvia il backend compilato su `127.0.0.1:8181` con una directory temporanea dedicata e
verifica: caricamento (input e drag-and-drop), caricamento multiplo, scelta del formato e delle
opzioni, avvio, stati, errore per file non valido, rimozione dalla coda, download singolo e ZIP,
cambio tema con persistenza, uso da tastiera (skip link, radio con frecce, pannello diagnostico
con Esc, focus visibile) e assenza di richieste verso host esterni.

## Smoke test in Docker

```bash
docker compose up -d --build
```

```bash
pnpm smoke
```

Esegue tutte le conversioni con gli strumenti reali contro l'istanza in ascolto su
`http://127.0.0.1:8080` (modificabile con `BASE_URL`). Su un'installazione nativa incompleta usa
`pnpm smoke -- --allow-missing` per saltare le conversioni senza strumento.

## Benchmark delle conversioni

Con l'app in esecuzione (`pnpm start` o Docker):

```bash
pnpm bench
```

Per ogni combinazione di fixture, formato e modalità mostra durata minima/mediana/massima,
esito e sequenza degli stati osservati. Un caso che non termina entro 60 secondi viene segnato
come `BLOCCATO` e lo script esce con codice 1. Opzioni: `pnpm bench -- --runs=10`, `BASE_URL=...`.
I tempi includono la latenza HTTP del client: per la durata pura della conversione guarda il campo
`durationMs` delle righe `file converted` nei log del server.

## Fixture

`tests/fixtures/files/` contiene documenti inventati generati da
`tests/fixtures/scripts/generate-fixtures.mjs` (`pnpm fixtures`), senza strumenti esterni:

| File                | Contenuto                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `simple.md`         | titoli, elenco, link, tabella, nota                                                                                         |
| `embedded-image.md` | immagine incorporata come data URI                                                                                          |
| `with-images.zip`   | pacchetto Markdown con due immagini locali e un'immagine remota                                                             |
| `simple.docx`       | DOCX minimale scritto a mano: titoli, immagine con testo alternativo, didascalia, tabella, link                             |
| `text.pdf`          | PDF di 3 pagine scritto a mano: titoli, elenchi, link, immagine, intestazioni e numeri di pagina ripetuti, parola sillabata |
| `scanned.pdf`       | PDF con una sola immagine di testo (simula una scansione)                                                                   |
| `fake.pdf`          | testo con estensione `.pdf` (per i test di validazione)                                                                     |

I file pericolosi (ZIP Slip, zip bomb, nomi malevoli) vengono creati al volo dai test, non sono
salvati nel repository.

# Sicurezza

Ogni file caricato è trattato come **input non attendibile**: potrebbe essere malformato,
enorme, costruito apposta per sfruttare un bug di un convertitore o contenere nomi di file
malevoli. Questo documento elenca le minacce considerate e la contromisura implementata, con il
file in cui trovarla.

Per il modello di privacy rivolto all'utente vedi anche [SECURITY.md](../SECURITY.md) e la sezione
"Privacy" del [README](../README.md).

## Esposizione di rete

| Minaccia                                                            | Contromisura                                                                                                                                                                                                    | Dove                                                      |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Altri computer della LAN usano il servizio                          | `HOST=127.0.0.1` predefinito; la config rifiuta host diversi da loopback se `ALLOW_NON_LOOPBACK` non è `true`                                                                                                   | `src/config.ts`                                           |
| Container raggiungibile dalla LAN                                   | Compose pubblica `127.0.0.1:8080:8080`                                                                                                                                                                          | `docker-compose.yml`                                      |
| Un sito web aperto nel browser invia richieste a `localhost` (CSRF) | per i metodi che modificano lo stato, l'header `Origin` (se presente) deve coincidere con l'host del servizio; ogni richiesta con `Sec-Fetch-Site: cross-site` è rifiutata; nessun header CORS viene mai emesso | `src/http/request-guard.ts`                               |
| DNS rebinding (un dominio esterno che risolve in 127.0.0.1)         | l'header `Host` deve essere `127.0.0.1`, `localhost` o `[::1]` (più `ALLOWED_HOSTS`)                                                                                                                            | `src/http/request-guard.ts`                               |
| Script/risorse iniettati nella pagina                               | Content-Security-Policy `default-src 'self'`, nessuna risorsa esterna, nessun `eval`                                                                                                                            | `src/http/security-headers.ts`                            |
| Clickjacking                                                        | `frame-ancestors 'none'`, `X-Frame-Options: DENY`                                                                                                                                                               | `src/http/security-headers.ts`                            |
| Sniffing del tipo di contenuto                                      | `X-Content-Type-Options: nosniff`; download con `Content-Disposition: attachment`                                                                                                                               | `src/http/security-headers.ts`, `src/routes/downloads.ts` |

## Upload e validazione

| Minaccia                               | Contromisura                                                                                                                                                                                                                                    | Dove                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| File troppo grandi                     | `MAX_FILE_SIZE_MB` applicato **durante** lo streaming (l'upload viene interrotto), `MAX_TOTAL_SIZE_MB` per job, `MAX_FILES_PER_JOB`                                                                                                             | `src/jobs/job-service.ts`                                  |
| Tipo di file falsificato               | 1) estensione ammessa, 2) MIME dichiarato compatibile, 3) firma/magic bytes, 4) controllo di struttura                                                                                                                                          | `src/files/file-validation.ts`                             |
| Zip bomb (DOCX o pacchetto MD)         | lettura della directory centrale senza estrarre: numero massimo di voci, dimensione decompressa totale e rapporto di compressione                                                                                                               | `src/files/zip-inspect.ts`                                 |
| ZIP Slip (`../../evil` in un archivio) | ogni voce è normalizzata e rifiutata se assoluta, con `..`, con lettere di unità o se il percorso risolto esce dalla directory di destinazione                                                                                                  | `src/files/safe-path.ts`, `src/files/zip-inspect.ts`       |
| Nomi di file malevoli                  | il nome originale non viene mai usato sul disco (i file sono salvati come `input.<ext>` in una directory con UUID); il nome di download è sanitizzato (niente separatori, caratteri di controllo, nomi riservati di Windows, lunghezza massima) | `src/files/sanitize-filename.ts`                           |
| Path traversal tramite ID              | gli ID devono essere UUID v4 validi (schema Zod) prima di costruire qualsiasi percorso                                                                                                                                                          | `src/routes/*.ts`                                          |
| Immagini remote nel Markdown           | Pandoc gira con `--sandbox` (nessun accesso a rete o file non indicati); le immagini locali dei pacchetti vengono lette dal backend solo se interne all'archivio                                                                                | `src/tools/pandoc.ts`, `src/conversion/markdown-bundle.ts` |
| Link `javascript:` nei PDF             | nei link estratti sono accettati solo `http:`, `https:`, `mailto:`                                                                                                                                                                              | `src/conversion/pdf/pdf-extract.ts`                        |

## Processi esterni

| Minaccia                            | Contromisura                                                                                                                                                                         | Dove                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Command injection                   | `spawn(eseguibile, argomenti[])` con `shell: false`; nessuna stringa di comando concatenata; i valori controllati dall'utente (lingue OCR) sono confrontati con una lista consentita | `src/process/process-runner.ts`, `src/tools/*.ts`                   |
| Argomenti interpretati come opzioni | i percorsi passati agli strumenti sono sempre assoluti e generati dal backend (non iniziano mai con `-`)                                                                             | `src/files/temp-store.ts`                                           |
| Eseguibile sbagliato nel PATH       | percorsi configurabili (`PANDOC_PATH`, ...); la risoluzione usa solo percorsi assoluti                                                                                               | `src/process/resolve-executable.ts`                                 |
| Processi bloccati                   | timeout (`CONVERSION_TIMEOUT_SECONDS`), terminazione dell'intero albero di processi (`taskkill /T` su Windows, gruppo di processi su Linux/macOS)                                    | `src/process/process-runner.ts`                                     |
| Output enorme                       | stdout/stderr conservati solo per gli ultimi 64 KB; dimensione dei risultati confrontata con `MAX_OUTPUT_SIZE_MB`                                                                    | `src/process/process-runner.ts`, `src/conversion/run-conversion.ts` |
| Fuga di variabili d'ambiente        | ai processi figli passa solo un elenco minimo di variabili (`PATH`, `SystemRoot`...), con `HOME`/`TMP` puntati alla directory del job                                                | `src/process/child-env.ts`                                          |
| Blocchi tra istanze LibreOffice     | profilo utente separato per ogni conversione (`-env:UserInstallation=file:///...`)                                                                                                   | `src/tools/libreoffice.ts`                                          |
| `.cmd`/`.bat` su Windows            | rifiutati: richiederebbero `shell: true`                                                                                                                                             | `src/process/resolve-executable.ts`                                 |

`stderr` non viene mai inviato al browser né scritto nei log, perché potrebbe contenere frammenti
del documento. Viene usato solo per riconoscere errori noti (es. PDF protetto da password).

## File temporanei

- Ogni job ha la propria directory `TEMP_DIR/job-<uuid>/` con sottodirectory `input`, `work`, `output`.
- Prima di cancellare, `TempStore.removeJobDir()` verifica che il percorso risolto sia **dentro**
  `TEMP_DIR` e che il nome corrisponda a `job-<uuid>`. Altrimenti si rifiuta.
- La pulizia avviene: su richiesta, dopo il download completo, alla scadenza del TTL, dopo errori e
  annullamenti (directory di lavoro del file), all'arresto e all'avvio (directory orfane più vecchie
  del TTL).

## Gestione degli errori

- Gli errori previsti sono `AppError` con un codice stabile.
- Qualsiasi altro errore diventa `INTERNAL_ERROR` con messaggio generico; lo stack trace finisce
  solo nei log del server.
- Le risposte non contengono stack trace, comandi, percorsi, variabili d'ambiente, stderr o
  contenuto dei documenti.

## Logging

- Log JSON strutturati (pino, integrato in Fastify).
- Mai: contenuto dei documenti, nomi originali dei file, stderr degli strumenti, header `Cookie` o
  `Authorization`.
- Sì: ID di correlazione, ID di job/file (casuali), formato, durata, codice di errore, exit code.

## Codici di errore

Elenco completo e stabile (definito in `packages/shared/src/errors.ts`).

| Codice                       | HTTP | Significato                                              |
| ---------------------------- | ---- | -------------------------------------------------------- |
| `VALIDATION_ERROR`           | 400  | parametri o corpo della richiesta non validi             |
| `MISSING_FILE`               | 400  | richiesta di upload senza file                           |
| `TOO_MANY_FILES`             | 400  | superato `MAX_FILES_PER_JOB`                             |
| `FORBIDDEN_REQUEST`          | 403  | header `Host` o `Origin` non consentiti                  |
| `NOT_FOUND`                  | 404  | job o file inesistente (o già eliminato)                 |
| `JOB_STATE_CONFLICT`         | 409  | operazione non ammessa nello stato attuale               |
| `RESULT_NOT_READY`           | 409  | risultato non ancora disponibile                         |
| `FILE_TOO_LARGE`             | 413  | file oltre `MAX_FILE_SIZE_MB`                            |
| `TOTAL_SIZE_EXCEEDED`        | 413  | somma dei file oltre `MAX_TOTAL_SIZE_MB`                 |
| `UNSUPPORTED_FILE_TYPE`      | 415  | estensione o MIME non ammessi                            |
| `INVALID_FILE_CONTENT`       | 415  | il contenuto non corrisponde al formato dichiarato       |
| `UNSAFE_ARCHIVE`             | 415  | archivio con percorsi pericolosi o dimensioni sospette   |
| `INTERNAL_ERROR`             | 500  | errore imprevisto                                        |
| `SERVICE_BUSY`               | 503  | troppi job attivi (`MAX_ACTIVE_JOBS`) o arresto in corso |
| `UNSUPPORTED_CONVERSION`     | —    | (per file) coppia di formati non supportata              |
| `DEPENDENCY_MISSING`         | —    | (per file) strumento necessario non installato           |
| `OCR_LANGUAGE_NOT_AVAILABLE` | —    | (per file) lingua OCR non installata                     |
| `PDF_ENCRYPTED`              | —    | (per file) PDF protetto da password                      |
| `CONVERSION_FAILED`          | —    | (per file) lo strumento ha terminato con errore          |
| `CONVERSION_TIMEOUT`         | —    | (per file) superato `CONVERSION_TIMEOUT_SECONDS`         |
| `OUTPUT_TOO_LARGE`           | —    | (per file) risultato oltre `MAX_OUTPUT_SIZE_MB`          |

I codici "per file" non sono risposte HTTP: compaiono nel campo `error` del singolo file nello
stato del job.

## Test di sicurezza

I test in `apps/backend/test/` coprono: nomi malevoli, path traversal negli ID e negli archivi,
ZIP Slip, zip bomb, firme non corrispondenti, limiti di dimensione e numero, header `Host`/`Origin`
non consentiti, timeout e annullamento dei processi, cancellazione fuori da `TEMP_DIR`, assenza di
percorsi e stack trace nelle risposte, binding predefinito su loopback.

# Docker

L'immagine Docker contiene tutto il necessario: Node.js 24, Pandoc, LibreOffice headless,
Tesseract con le lingue italiana e inglese, OCRmyPDF e i font DejaVu/Liberation.

## Avvio

```bash
docker compose up -d --build
```

Interfaccia: <http://127.0.0.1:8080>. Stato del container (la colonna STATUS mostra `healthy`
quando l'health check risponde):

```bash
docker compose ps
```

Log (JSON, senza contenuti dei documenti):

```bash
docker compose logs -f converter
```

Arresto (il container riceve SIGTERM: annulla i job e cancella i file temporanei):

```bash
docker compose down
```

Diagnostica degli strumenti dentro il container:

```bash
docker compose exec converter node -e "fetch('http://127.0.0.1:8080/api/diagnostics').then(r=>r.json()).then(r=>console.log(JSON.stringify(r.tools,null,2)))"
```

## Smoke test con gli strumenti reali

Con il container avviato, dalla radice del repository (serve Node.js sull'host, non servono
dipendenze):

```bash
pnpm smoke
```

Il test carica le fixture, esegue tutte le conversioni (comprese MD → PDF, DOCX → PDF,
PDF → DOCX alta fedeltà e OCR) e verifica che i risultati siano file validi.

## Scelte dell'immagine

| Scelta                                    | Motivo                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `node:24.19.0-trixie-slim`                | Node 24 LTS, Debian 13 stabile: versione fissata, aggiornamenti solo di sicurezza     |
| build multi-stage                         | strumenti di compilazione e dipendenze di sviluppo restano fuori dall'immagine finale |
| `--no-install-recommends`                 | evita centinaia di MB di pacchetti grafici                                            |
| `libreoffice-writer-nogui`, `-draw-nogui` | LibreOffice senza interfaccia grafica; Draw contiene l'importazione PDF               |
| utente `node` (uid 1000)                  | il processo non gira come root                                                        |
| health check in Node                      | non serve installare `curl`                                                           |

Le versioni dei pacchetti Debian (Pandoc 3.1, LibreOffice 25.2, Tesseract 5.5, OCRmyPDF 16 in
Debian 13) sono quelle della release stabile: per una riproducibilità totale si può fissare
anche il digest dell'immagine base (`node:24.19.0-trixie-slim@sha256:...`).

## Rete e porte

```yaml
ports:
  - '127.0.0.1:${HOST_PORT:-8080}:8080'
```

Dentro il container il server ascolta su `0.0.0.0` (necessario perché Docker possa inoltrare la
porta), ma la porta viene pubblicata **solo** su `127.0.0.1` dell'host: dalla LAN non è
raggiungibile. Per usare un'altra porta sull'host:

```bash
HOST_PORT=9090 docker compose up -d
```

## Ciclo di vita dei file

1. Upload → `/tmp/md-converter/job-<uuid>/input/<uuid-file>.<ext>` nel container.
2. Conversione → file intermedi in `.../work/<uuid-file>/` (profilo LibreOffice, PDF con OCR,
   immagini estratte). La directory viene cancellata a fine conversione, anche in caso di errore.
3. Risultato → `.../output/<uuid-file>/result.<ext>`.
4. Eliminazione del job → su richiesta, 5 minuti dopo il download di tutti i risultati, dopo 60
   minuti di inattività, all'arresto del container.

`/tmp` è un **tmpfs** (in RAM, limite 2 GB in `docker-compose.yml`): niente viene scritto sul
disco dell'host e tutto sparisce quando il container si ferma. Il filesystem del container è in
sola lettura (`read_only: true`). Per file molto grandi aumenta `size=` del tmpfs e il limite di
memoria in `deploy.resources.limits`.

## Windows con Docker Desktop

1. Installa Docker Desktop e scegli il backend **WSL 2** (proposto durante l'installazione).
2. Clona il repository preferibilmente **dentro il filesystem di WSL** (es. `~/progetti` in
   Ubuntu): il build è molto più veloce che da `C:\`.
3. Esegui `docker compose up -d --build` dal terminale di Ubuntu (WSL) o da PowerShell.
4. Apri <http://127.0.0.1:8080> dal browser di Windows: Docker Desktop inoltra `127.0.0.1`.

Se Git converte i fine riga in CRLF, il repository usa comunque `.gitattributes` con `eol=lf`.

## macOS con Docker Desktop

Su Apple Silicon l'immagine viene costruita per `arm64` nativamente (tutti i pacchetti usati
esistono per arm64). Se l'avvio è lento, assegna almeno 4 GB di memoria a Docker Desktop
(Settings → Resources).

## Linux

Installa Docker Engine e il plugin Compose dal repository ufficiale di Docker, poi:

```bash
docker compose up -d --build
```

Se usi Docker senza `sudo`, il tuo utente deve appartenere al gruppo `docker`. Con Docker
_rootless_ la pubblicazione su `127.0.0.1` funziona allo stesso modo.

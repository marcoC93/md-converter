# Risoluzione dei problemi

Prima di tutto apri il pannello **Diagnostica** nell'interfaccia oppure esegui `pnpm diagnose`:
mostra quali strumenti sono stati trovati, la loro versione e cosa abilitano.

Ogni messaggio d'errore mostra un **codice di riferimento** (ID di correlazione). Cercalo nei log
del backend per trovare i dettagli tecnici:

```bash
docker compose logs converter | grep <codice>
```

## L'app non si avvia

| Sintomo                                          | Causa e soluzione                                                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `Configurazione non valida: ...`                 | una variabile in `.env` ha un valore non valido; il messaggio indica quale. Confronta con `.env.example` |
| `HOST=0.0.0.0 esporrebbe il servizio sulla rete` | voluto: vedi README, sezione Privacy. Usa `127.0.0.1`                                                    |
| `EADDRINUSE`                                     | la porta 8080 è occupata: imposta `PORT=8090` in `.env` (in Docker `HOST_PORT=8090`)                     |
| `engine "node" is incompatible`                  | serve Node.js ≥ 22.13                                                                                    |
| pagina bianca o `404` su `/`                     | il frontend non è compilato: esegui `pnpm build`                                                         |
| `Unsupported engine` / `pnpm: command not found` | installa pnpm con `npm install -g pnpm@10`                                                               |

## "Uno strumento necessario non è installato" (`DEPENDENCY_MISSING`)

1. Controlla il pannello Diagnostica: lo strumento risulta "Non disponibile"?
2. Verifica che funzioni da terminale (`pandoc --version`, `soffice --version`...).
3. Se funziona da terminale ma non viene trovato, indica il percorso completo in `.env`
   (`PANDOC_PATH`, `LIBREOFFICE_PATH`, `TESSERACT_PATH`, `OCRMYPDF_PATH`) e riavvia.
4. Premi **Controlla di nuovo** nel pannello Diagnostica.

`VERSION_TOO_OLD` per Pandoc: serve almeno la 2.15 (per `--sandbox`).

## Conversioni lente o in timeout (`CONVERSION_TIMEOUT`)

- L'OCR è lento per natura (decine di secondi per pagina su CPU modeste). Aumenta
  `CONVERSION_TIMEOUT_SECONDS` e, se hai core liberi, `OCR_JOBS`.
- Il primo avvio di LibreOffice crea un profilo e può richiedere 10-20 secondi.
- Su Windows l'antivirus rallenta l'avvio di Pandoc e LibreOffice.

## PDF → Markdown/DOCX: risultato vuoto o avviso "Nessun testo estratto"

Il PDF probabilmente è una scansione (immagini delle pagine, senza testo). Attiva l'OCR in
**Opzioni avanzate** scegliendo la lingua corretta. L'interfaccia lo suggerisce quando rileva
poco testo.

## PDF → Markdown: tabelle "appiattite" o testo su più colonne mescolato

È un limite noto: il PDF non contiene informazioni sulle tabelle. Vedi
[known-limitations.md](known-limitations.md). Per PDF → DOCX prova la modalità **alta fedeltà**,
che conserva l'aspetto delle pagine.

## DOCX → PDF: font diversi dall'originale

LibreOffice sostituisce i font non installati. In Docker sono presenti DejaVu e Liberation
(metricamente compatibili con Arial, Times New Roman e Courier New). Su un'installazione nativa
installa i font usati nel documento.

## Immagini mancanti nel Markdown → DOCX

- Un file `.md` caricato da solo **non** include le immagini a cui fa riferimento: crea uno ZIP
  con il file `.md` e le immagini (con gli stessi percorsi relativi usati nel Markdown).
- Le immagini remote (`https://...`) non vengono mai scaricate, per privacy (avviso
  `REMOTE_IMAGES_BLOCKED`).

## "La sessione di conversione è scaduta"

I job vengono eliminati dopo 60 minuti di inattività (`JOB_TTL_MINUTES`) e 5 minuti dopo il
download di tutti i risultati (`CLEANUP_AFTER_DOWNLOAD_SECONDS`), oppure al riavvio del backend.
Premi **Nuova conversione** e ricarica i file.

## Richieste rifiutate (`FORBIDDEN_REQUEST`)

Il backend accetta solo header `Host` di loopback (`127.0.0.1`, `localhost`, `[::1]`). Se accedi
tramite un altro nome (es. un alias in `/etc/hosts`), aggiungilo ad `ALLOWED_HOSTS` in `.env`.

## Client HTTP che restano bloccati ~30 secondi

Osservato su Windows con Fastify e `keepAliveTimeout` predefinito di 72 secondi: una connessione
keep-alive riusata dopo pochi istanti di inattività restava bloccata. Il backend imposta ora
`keepAliveTimeout` a 5 secondi (vedi [implementation-log.md](implementation-log.md)).

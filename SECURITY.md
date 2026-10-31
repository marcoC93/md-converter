# Sicurezza e privacy

## Modello d'uso

Il convertitore è un'applicazione **monoutente e locale**: non ha login perché è pensato per
essere raggiungibile solo dal computer su cui gira. La sicurezza si basa su questo presupposto.

- Ascolto predefinito: `127.0.0.1` (nativo) e `127.0.0.1:8080` sull'host (Docker).
- Nessun dato lascia il computer: nessuna API cloud, telemetria, CDN o risorsa esterna.
- I documenti caricati sono trattati come input non attendibili.

Se esponi il servizio sulla rete (`HOST=0.0.0.0` + `ALLOW_NON_LOOPBACK=true`) chiunque sulla rete
potrà usarlo senza autenticazione. Leggi la sezione "Privacy e rete" del [README](README.md).

## Protezioni principali

- Validazione di estensione, MIME, firma e struttura di ogni file; limiti di dimensione e numero.
- Protezione da ZIP Slip, zip bomb, path traversal e nomi di file malevoli.
- Processi esterni avviati con `spawn` e argomenti in array, `shell: false`, timeout, limiti di
  output e terminazione dell'intero albero di processi; ambiente ridotto al minimo.
- Pandoc in `--sandbox` (nessun accesso a rete o file non indicati).
- Directory temporanea isolata per job, cancellazioni consentite solo dentro `TEMP_DIR`.
- Header di sicurezza (CSP restrittiva, `nosniff`, `frame-ancestors 'none'`...), nessun header
  CORS, controllo di `Host` (DNS rebinding) e `Origin` (CSRF).
- Errori con codici stabili: niente stack trace, percorsi, comandi, stderr o contenuti al browser.
- Log strutturati senza contenuti né nomi dei documenti.
- Container Docker con utente non root, filesystem in sola lettura, `/tmp` in RAM, nessuna
  capability Linux, `no-new-privileges`, limiti di CPU e memoria.

Analisi completa delle minacce e delle contromisure, con i file in cui sono implementate:
[docs/security.md](docs/security.md).

## Aggiornare le dipendenze

Le vulnerabilità più probabili arrivano dagli strumenti che leggono i documenti (pdf.js, Pandoc,
LibreOffice, Tesseract). Tienili aggiornati:

- dipendenze Node: `pnpm outdated` e `pnpm audit`;
- immagine Docker: aggiorna `NODE_IMAGE` in `docker/Dockerfile` e ricostruisci con
  `docker compose build --pull`;
- installazione nativa: aggiorna gli strumenti con il gestore di pacchetti del sistema.

## Segnalare un problema

Segnala le vulnerabilità al responsabile del progetto senza allegare documenti reali. Includi, se
disponibile, l'**ID di correlazione** mostrato nel messaggio d'errore: permette di trovare la
riga corrispondente nei log senza esporre il contenuto dei file.

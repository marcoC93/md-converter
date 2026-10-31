# Installazione nativa su Linux (Debian 13 / Ubuntu 24.04 o successivi)

## 1. Node.js e pnpm

Le versioni di Node.js dei repository Debian/Ubuntu possono essere vecchie. Usa i pacchetti
ufficiali NodeSource oppure un gestore di versioni come `nvm`. Con NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
```

```bash
sudo apt install -y nodejs
```

```bash
sudo npm install -g pnpm@10
```

Verifica (deve essere ≥ 22.13):

```bash
node --version
```

## 2. Strumenti di conversione

```bash
sudo apt update
```

```bash
sudo apt install -y --no-install-recommends pandoc libreoffice-writer-nogui libreoffice-draw-nogui fonts-dejavu-core fonts-liberation2
```

- `--no-install-recommends` evita di installare l'interfaccia grafica completa di LibreOffice.
- `libreoffice-draw-nogui` serve per PDF → DOCX in alta fedeltà (importazione PDF).
- Pandoc deve essere ≥ 2.15 (Debian 12+ e Ubuntu 22.04+ vanno bene).

## 3. OCR (facoltativo)

```bash
sudo apt install -y tesseract-ocr tesseract-ocr-ita tesseract-ocr-eng ocrmypdf
```

Verifica:

```bash
tesseract --list-langs
```

```bash
ocrmypdf --version
```

## 4. Avvio

```bash
pnpm install
pnpm build
pnpm diagnose
pnpm start
```

Apri <http://127.0.0.1:8080>.

## Avvio come servizio utente (facoltativo)

Per avviarlo automaticamente al login senza privilegi di root, crea
`~/.config/systemd/user/md-converter.service`:

```ini
[Unit]
Description=Convertitore documenti locale

[Service]
WorkingDirectory=%h/progetti/md-converter
ExecStart=/usr/bin/node --env-file-if-exists=.env apps/backend/dist/index.js
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload && systemctl --user enable --now md-converter
```

Il servizio continua ad ascoltare solo su `127.0.0.1`.

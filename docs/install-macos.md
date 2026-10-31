# Installazione nativa su macOS

Richiede [Homebrew](https://brew.sh). I comandi vanno eseguiti nel Terminale.

## 1. Node.js e pnpm

```bash
brew install node@24
```

```bash
npm install -g pnpm@10
```

```bash
node --version
```

## 2. Strumenti di conversione

```bash
brew install pandoc
```

```bash
brew install --cask libreoffice
```

LibreOffice viene installato in `/Applications/LibreOffice.app`: il backend lo trova
automaticamente in `/Applications/LibreOffice.app/Contents/MacOS/soffice`.

## 3. OCR (facoltativo)

```bash
brew install tesseract tesseract-lang ocrmypdf
```

`tesseract-lang` contiene tutte le lingue, italiano compreso. Verifica:

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

## Note per macOS

- Su Apple Silicon Homebrew usa `/opt/homebrew/bin`, su Intel `/usr/local/bin`: il backend
  controlla entrambi.
- Al primo avvio macOS può chiedere conferma per LibreOffice ("app scaricata da Internet"):
  aprila una volta dal Finder, poi le conversioni headless funzionano senza finestre.
- Se `pnpm diagnose` non trova uno strumento installato, indica il percorso in `.env`
  (`PANDOC_PATH`, `LIBREOFFICE_PATH`, ...). Trovi il percorso con `which pandoc`.

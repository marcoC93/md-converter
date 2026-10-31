# Matrice delle conversioni

Questo documento descrive **quale strumento esegue ogni conversione**, cosa cambia tra modalità
semplice e alta fedeltà e quali limiti sono realistici. È la fonte di verità per il codice in
`apps/backend/src/conversion/pipeline-selector.ts`.

## Formati di ingresso accettati

| Formato             | Estensioni         | Controllo del contenuto                                                                     |
| ------------------- | ------------------ | ------------------------------------------------------------------------------------------- |
| Markdown            | `.md`, `.markdown` | Testo UTF-8 valido, nessun byte NUL                                                         |
| Markdown + immagini | `.zip`             | Archivio con **un solo** file `.md` e immagini (`png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`) |
| DOCX                | `.docx`            | Firma ZIP `PK\x03\x04` e presenza di `[Content_Types].xml` e `word/document.xml`            |
| PDF                 | `.pdf`             | Firma `%PDF-` nei primi 1024 byte                                                           |

Il pacchetto `.zip` Markdown esiste perché un file `.md` caricato da solo non porta con sé le
immagini a cui fa riferimento (es. `![logo](img/logo.png)`).

## Pipeline

| #   | Conversione               | Pipeline effettiva                                                                                                                    | Strumenti richiesti                                                                   |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | Markdown → DOCX           | (pacchetto zip: estrazione sicura + immagini locali trasformate in data URI) → `pandoc --sandbox -t docx`                             | Pandoc                                                                                |
| 2   | Markdown → PDF            | come #1 per ottenere un DOCX intermedio → LibreOffice headless `--convert-to pdf`                                                     | Pandoc + LibreOffice                                                                  |
| 3   | DOCX → Markdown           | `pandoc --sandbox -f docx --extract-media` → rinomina immagini in `images/` oppure incorporazione Base64                              | Pandoc                                                                                |
| 4   | DOCX → PDF                | LibreOffice headless `--convert-to pdf`                                                                                               | LibreOffice                                                                           |
| 5   | PDF → Markdown            | (OCRmyPDF opzionale) → estrazione con pdf.js (testo, posizione, dimensione font, link, immagini) → euristiche di struttura → Markdown | nessuno (pdf.js è una libreria JavaScript inclusa); OCRmyPDF + Tesseract solo con OCR |
| 6a  | PDF → DOCX (semplice)     | pipeline #5 → Markdown intermedio con immagini incorporate → `pandoc --sandbox -t docx`                                               | Pandoc (+ OCRmyPDF con OCR)                                                           |
| 6b  | PDF → DOCX (alta fedeltà) | (OCRmyPDF opzionale) → LibreOffice `--infilter=writer_pdf_import --convert-to docx`                                                   | LibreOffice (+ OCRmyPDF con OCR)                                                      |

Tutte le sei coppie richieste sono coperte. Le conversioni tra formati identici (es. PDF → PDF)
vengono rifiutate con il codice `UNSUPPORTED_CONVERSION`.

### Perché Markdown → PDF passa da DOCX

Pandoc non produce PDF da solo: richiede un "motore PDF" esterno (LaTeX, WeasyPrint, Typst...).
LaTeX pesa diversi GB ed è difficile da installare su Windows. LibreOffice è già necessario per
DOCX → PDF, quindi riutilizzarlo evita una dipendenza in più e rende i PDF coerenti tra le due
conversioni. Il prezzo è una tipografia meno raffinata rispetto a LaTeX.

### Perché PDF → DOCX ha due pipeline

- `writer_pdf_import` di LibreOffice ricostruisce **l'aspetto** della pagina posizionando ogni riga
  in una cornice di testo. Il risultato somiglia molto all'originale ma è scomodo da modificare
  (niente paragrafi veri, niente titoli). Per questo è usato solo in alta fedeltà.
- La modalità semplice ricostruisce **la struttura** (titoli, paragrafi, elenchi, link, immagini)
  e produce un DOCX pulito e modificabile, ma perde l'impaginazione.

## Cosa cambia tra le modalità

| Conversione   | Semplice                                                                                             | Alta fedeltà                                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| MD → DOCX/PDF | lettore `gfm` (GitHub Flavored Markdown): titoli, elenchi, tabelle pipe, link, immagini              | lettore `markdown` di Pandoc: in più note a piè di pagina, didascalie delle figure, liste di definizioni, attributi                     |
| DOCX → MD     | scrittore `gfm`: Markdown compatto, attributi delle immagini rimossi, tabelle complesse in HTML      | scrittore `markdown` di Pandoc: note, didascalie, tabelle a griglia, attributi di dimensione delle immagini                             |
| DOCX → PDF    | nessuna differenza (LibreOffice conserva già impaginazione, intestazioni e piè di pagina)            | nessuna differenza                                                                                                                      |
| PDF → MD      | rimuove intestazioni/piè di pagina ripetuti e numeri di pagina, ignora immagini decorative (< 48 px) | conserva intestazioni/piè di pagina, inserisce un commento `<!-- Pagina N -->` a ogni pagina, conserva quasi tutte le immagini (≥ 8 px) |
| PDF → DOCX    | struttura (vedi pipeline 6a)                                                                         | aspetto (vedi pipeline 6b)                                                                                                              |

## Immagini nell'output Markdown

| Opzione                  | Risultato                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `separate` (predefinita) | ZIP con `nome.md` e `images/image-001.png`, ... con riferimenti relativi. Senza immagini: solo `.md` |
| `embedded`               | un solo `.md` con immagini `data:image/...;base64,...`                                               |

Se la somma delle immagini incorporate supera `MAX_EMBEDDED_IMAGES_BYTES` (predefinito 10 MB), il
backend **passa automaticamente** alla modalità `separate` e lo segnala con l'avviso
`EMBED_LIMIT_FALLBACK`, mostrato nell'interfaccia.

Le immagini EMF/WMF provenienti da Word vengono estratte così come sono: molti visualizzatori
Markdown non le mostrano (avviso `UNSUPPORTED_IMAGE_FORMAT`).

## OCR

- Disattivato per impostazione predefinita.
- All'upload ogni PDF viene analizzato con pdf.js: se ha in media meno di 20 caratteri per pagina
  l'interfaccia **suggerisce** l'OCR, senza attivarlo.
- Con OCR attivo viene eseguito `ocrmypdf --skip-text`: le pagine che contengono già testo non
  vengono riprocessate. L'opzione avanzata "Forza OCR" usa `--force-ocr` (rasterizza anche le pagine
  con testo: utile quando il testo esistente è corrotto).
- Il PDF intermedio con OCR resta solo nella directory temporanea del job.
- Senza OCRmyPDF/Tesseract le conversioni senza OCR continuano a funzionare; quelle con OCR
  falliscono con `DEPENDENCY_MISSING` e un messaggio che rimanda al pannello diagnostico.

## Livello di fedeltà realistico

| Conversione | Atteso                                                                                                                                                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MD → DOCX   | Alto. Pandoc conosce bene entrambi i formati.                                                                                                                                                                                                      |
| MD → PDF    | Buono. Stili predefiniti di Pandoc/LibreOffice.                                                                                                                                                                                                    |
| DOCX → MD   | Buono per testo, titoli, elenchi, tabelle semplici, link, note, immagini. Persi: intestazioni/piè di pagina, colori, caselle di testo, layout a colonne.                                                                                           |
| DOCX → PDF  | Molto alto. LibreOffice impagina il documento; differenze possibili se mancano i font usati nel DOCX.                                                                                                                                              |
| PDF → MD    | Medio. I titoli sono dedotti dalla dimensione del carattere, gli elenchi dai simboli iniziali. **Tabelle e colonne multiple non vengono ricostruite** (il testo resta leggibile ma linearizzato). Testo alternativo delle immagini non recuperato. |
| PDF → DOCX  | Semplice: come PDF → MD. Alta fedeltà: aspetto simile ma testo in cornici posizionate.                                                                                                                                                             |

Un PDF memorizza principalmente **dove disegnare** glifi e immagini sulla pagina, non "questo è un
titolo" o "questa è una tabella". Alcuni PDF ("tagged PDF") contengono anche una struttura, ma
spesso è assente o incompleta. Nessuno strumento offline può garantire una ricostruzione perfetta.

## Confronto delle librerie per l'analisi dei PDF

| Opzione                                    | Licenza        | Piattaforme                               | Pro                                                                                     | Contro                                                       |
| ------------------------------------------ | -------------- | ----------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **pdf.js (`pdfjs-dist`)** — scelta         | Apache-2.0     | ovunque giri Node                         | mantenuto da Mozilla, posizioni e font del testo, link, immagini, nessun binario nativo | API di basso livello, la struttura va dedotta                |
| Poppler (`pdftotext`, `pdfimages`)         | GPL            | binari diversi per OS                     | veloce, maturo                                                                          | altra dipendenza di sistema, scomodo su Windows              |
| `pdf2docx` / `marker` / `docling` (Python) | MIT/GPL/Apache | richiede Python (e per alcuni modelli ML) | migliore ricostruzione di tabelle                                                       | secondo runtime, installazione pesante, modelli da scaricare |
| LibreOffice `writer_pdf_import`            | MPL-2.0        | già presente                              | nessuna dipendenza in più                                                               | produce cornici posizionate, non struttura                   |

pdf.js offre il miglior compromesso per un progetto TypeScript che deve funzionare offline anche su
Windows. Python non è stato introdotto: il guadagno (tabelle migliori) non giustifica un secondo
runtime e download di modelli.

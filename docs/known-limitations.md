# Limiti noti

## Conversioni da PDF

- **Tabelle**: non vengono ricostruite. Il testo delle celle resta leggibile ma diventa una
  sequenza di righe/paragrafi.
- **Più colonne**: l'ordine segue il contenuto interno del PDF, che di solito è corretto ma in
  alcuni documenti mescola le colonne.
- **Titoli**: dedotti dalla dimensione del carattere (grassetto e colori non sono considerati).
  Un PDF in cui tutto il testo ha la stessa dimensione non produce titoli.
- **Testo alternativo delle immagini**: non viene recuperato dai PDF "tagged"; viene usata la
  didascalia che segue l'immagine ("Figura 1: ...") oppure un testo generico.
- **Immagini**: estratte come PNG. Maschere, motivi grafici vettoriali e immagini inline molto
  piccole non vengono estratti. Immagini oltre 25 megapixel vengono saltate (avviso
  `IMAGES_SKIPPED`).
- **Note a piè di pagina, intestazioni**: in modalità semplice le righe ripetute in alto/basso su
  molte pagine vengono eliminate come intestazioni/piè di pagina; in alta fedeltà restano.
- **PDF → DOCX alta fedeltà**: LibreOffice posiziona il testo in cornici; il documento somiglia
  all'originale ma è scomodo da modificare.
- **PDF protetti da password**: rifiutati al caricamento.
- **Memoria**: pdf.js carica tutto il PDF in memoria; per questo `MAX_FILE_SIZE_MB` è 50 MB.

## Conversioni da DOCX

- Intestazioni, piè di pagina, caselle di testo, colori e layout a colonne si perdono verso
  Markdown (limite di Pandoc e del formato Markdown).
- Le immagini EMF/WMF vengono estratte così come sono: molti visualizzatori Markdown non le
  mostrano (avviso `UNSUPPORTED_IMAGE_FORMAT`).
- DOCX → PDF: se il documento usa font non installati, LibreOffice li sostituisce e
  l'impaginazione può cambiare.

## Conversioni da Markdown

- Markdown → PDF passa da DOCX: lo stile è quello predefinito di Pandoc/LibreOffice, non è
  configurabile dall'interfaccia.
- Le immagini remote non vengono mai scaricate (privacy). Le immagini locali vanno fornite con
  un pacchetto `.zip`.
- HTML grezzo dentro il Markdown viene ignorato nella conversione verso DOCX.

## OCR

- Richiede OCRmyPDF + Tesseract; su Windows nativo l'installazione è complessa (usare Docker o
  WSL2).
- Qualità dipendente dalla scansione (risoluzione, inclinazione, contrasto) e dalla lingua scelta.
- Il PDF di prova `scanned.pdf` usa un font a blocchi molto stilizzato: l'OCR potrebbe non
  riconoscerlo perfettamente. Serve a verificare la pipeline, non la qualità del riconoscimento.

## Applicazione

- Stato dei job in memoria: un riavvio del backend perde i job in corso (i file temporanei
  vengono comunque eliminati).
- Avanzamento percentuale reale solo per l'upload e per l'estrazione dai PDF (pagina per
  pagina). Per Pandoc, LibreOffice e OCRmyPDF viene mostrata la fase, non la percentuale.
- Una sola lingua dell'interfaccia (italiano); la struttura per aggiungerne altre è pronta
  (vedi [extending.md](extending.md)).
- Un job accetta nuovi file solo prima dell'avvio: per altri file si usa "Nuova conversione".

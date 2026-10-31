/**
 * Dizionario italiano. Le chiavi sono piatte ("sezione.voce") e i parametri si scrivono
 * tra graffe: t('queue.count', { count: 3 }). Per aggiungere una lingua vedi src/i18n/index.ts.
 */
export const it = {
  'app.title': 'Convertitore documenti',
  'app.subtitle': 'Markdown, Word e PDF. Tutto resta sul tuo computer.',
  'app.skipToContent': 'Vai al contenuto principale',
  'app.privacy':
    'I documenti vengono elaborati solo su questo computer: nessun dato viene inviato in rete.',

  'theme.label': 'Tema',
  'theme.system': 'Sistema',
  'theme.light': 'Chiaro',
  'theme.dark': 'Scuro',

  'drop.title': 'Trascina qui i file',
  'drop.or': 'oppure',
  'drop.choose': 'Scegli i file',
  'drop.hint':
    'Formati: .md, .markdown, .zip (Markdown con immagini), .docx, .pdf. Massimo {maxFiles} file, {maxSize} ciascuno, {maxTotal} in totale.',
  'drop.disabled':
    'La conversione è stata avviata. Premi "Nuova conversione" per caricare altri file.',
  'drop.added': '{count} file aggiunti alla coda.',

  'options.title': 'Opzioni di conversione',
  'options.outputFormat': 'Formato di uscita',
  'format.markdown': 'Markdown (.md)',
  'format.docx': 'Word (.docx)',
  'format.pdf': 'PDF (.pdf)',
  'options.mode': 'Modalità',
  'mode.simple': 'Semplice',
  'mode.simple.description':
    'Testo pulito e leggibile: titoli, paragrafi, elenchi, link, tabelle semplici.',
  'mode.high-fidelity': 'Alta fedeltà',
  'mode.high-fidelity.description':
    'Cerca di conservare immagini, note, didascalie, intestazioni e impaginazione.',
  'options.advanced': 'Opzioni avanzate',
  'options.images': 'Immagini nel Markdown',
  'options.images.onlyMarkdown': 'Disponibile solo quando il formato di uscita è Markdown.',
  'images.separate': 'In una cartella images/ (archivio ZIP)',
  'images.separate.description':
    'Consigliato. Il file .md e le immagini vengono consegnati insieme in uno ZIP.',
  'images.embedded': 'Incorporate nel file (Base64)',
  'images.embedded.description':
    'Un solo file .md, ma può diventare molto grande e alcuni visualizzatori non lo supportano. Oltre {limit} si passa automaticamente alla cartella separata.',
  'options.ocr': 'Riconoscimento del testo (OCR) per i PDF',
  'options.ocr.enable': 'Attiva OCR',
  'options.ocr.description': "Utile per PDF scansionati. L'OCR richiede più tempo e usa molta CPU.",
  'options.ocr.unavailable':
    'OCR non disponibile: OCRmyPDF o Tesseract non sono installati. Vedi Diagnostica.',
  'options.ocr.languages': 'Lingue del documento',
  'options.ocr.notInstalled': '(non installata)',
  'options.ocr.force': 'Forza OCR anche sulle pagine che contengono già testo',
  'options.ocr.forceDescription':
    'Da usare solo se il testo esistente è illeggibile: le pagine vengono trasformate in immagini.',
  'options.ocr.needLanguage': 'Seleziona almeno una lingua OCR.',
  'language.ita': 'Italiano',
  'language.eng': 'Inglese',

  'notice.pdf':
    "Attenzione: un PDF descrive soprattutto l'aspetto delle pagine, non la struttura del documento. Titoli, tabelle e colonne vengono dedotti e il risultato non sarà identico all'originale.",
  'notice.pdfHighFidelity':
    'In alta fedeltà il PDF diventa un DOCX con il testo in cornici posizionate: aspetto simile, ma modifica più scomoda.',

  'queue.title': 'Coda dei file',
  'queue.empty': 'Nessun file in coda.',
  'queue.summary': '{total} file · {completed} completati · {failed} con errore',
  'queue.remove': 'Rimuovi {name}',
  'queue.cancel': 'Annulla {name}',
  'queue.download': 'Scarica',
  'queue.cancelShort': 'Annulla',
  'queue.removeShort': 'Rimuovi',
  'queue.downloadLabel': 'Scarica il risultato di {name}',
  'queue.ocrSuggested':
    'Questo PDF sembra una scansione: il testo potrebbe non essere estraibile senza OCR.',
  'queue.enableOcr': 'Attiva OCR',
  'queue.pages': '{count} pagine',
  'queue.uploading': 'Caricamento',
  'queue.unavailable': 'Conversione non disponibile: strumento mancante ({tools}).',
  'queue.sameFormat': 'Il file è già nel formato scelto.',

  'actions.start': 'Converti',
  'actions.starting': 'Avvio…',
  'actions.cancelAll': 'Annulla tutto',
  'actions.downloadAll': 'Scarica tutto (ZIP)',
  'actions.newConversion': 'Nuova conversione',
  'actions.noReadyFiles': 'Aggiungi almeno un file valido per iniziare.',

  'status.uploading': 'Caricamento',
  'status.validating': 'Validazione',
  'status.ready': 'Pronto',
  'status.queued': 'In attesa',
  'status.converting': 'Conversione',
  'status.completed': 'Completato',
  'status.cancelled': 'Annullato',
  'status.failed': 'Errore',

  'stage.prepare': 'preparazione',
  'stage.pandoc': 'Pandoc',
  'stage.libreoffice': 'LibreOffice',
  'stage.ocr': 'OCR in corso',
  'stage.extract': 'estrazione dal PDF',
  'stage.images': 'immagini',

  'announce.fileStatus': '{name}: {status}.',
  'announce.allDone': 'Conversione terminata: {completed} completati, {failed} con errore.',
  'announce.jobExpired': 'La sessione di conversione è scaduta o è stata eliminata.',

  'error.generic': 'Si è verificato un errore.',
  'error.correlation': 'Codice di riferimento: {id}',
  'error.NETWORK_ERROR':
    'Impossibile contattare il servizio locale. Verifica che il backend sia avviato.',
  'error.VALIDATION_ERROR': 'La richiesta contiene dati non validi.',
  'error.MISSING_FILE': 'Nessun file ricevuto.',
  'error.TOO_MANY_FILES': 'Hai raggiunto il numero massimo di file.',
  'error.FORBIDDEN_REQUEST': 'Richiesta rifiutata per motivi di sicurezza.',
  'error.NOT_FOUND': 'Elemento non trovato: potrebbe essere già stato eliminato.',
  'error.JOB_STATE_CONFLICT': 'Operazione non consentita in questo momento.',
  'error.RESULT_NOT_READY': 'Il risultato non è ancora pronto.',
  'error.FILE_TOO_LARGE': 'Il file supera la dimensione massima consentita.',
  'error.TOTAL_SIZE_EXCEEDED': 'La dimensione complessiva dei file supera il limite.',
  'error.UNSUPPORTED_FILE_TYPE': 'Tipo di file non supportato.',
  'error.INVALID_FILE_CONTENT': 'Il contenuto del file non corrisponde al formato indicato.',
  'error.UNSAFE_ARCHIVE': "L'archivio contiene percorsi o dimensioni non sicuri.",
  'error.INTERNAL_ERROR': 'Errore imprevisto del servizio.',
  'error.SERVICE_BUSY': 'Il servizio è occupato. Riprova tra poco.',
  'error.UNSUPPORTED_CONVERSION': 'Questa conversione non è supportata.',
  'error.DEPENDENCY_MISSING': 'Manca uno strumento necessario. Apri il pannello Diagnostica.',
  'error.OCR_LANGUAGE_NOT_AVAILABLE': 'La lingua OCR scelta non è installata.',
  'error.PDF_ENCRYPTED': 'Il PDF è protetto da password.',
  'error.CONVERSION_FAILED': 'Non è stato possibile convertire il documento.',
  'error.CONVERSION_TIMEOUT': 'La conversione ha richiesto troppo tempo ed è stata interrotta.',
  'error.OUTPUT_TOO_LARGE': 'Il documento prodotto supera la dimensione massima.',

  'warning.EMBED_LIMIT_FALLBACK':
    'Immagini troppo grandi per essere incorporate: sono state salvate nella cartella images/.',
  'warning.UNSUPPORTED_IMAGE_FORMAT':
    'Alcune immagini (es. EMF/WMF) potrebbero non essere visualizzate dai programmi Markdown.',
  'warning.IMAGES_NOT_FOUND':
    'Alcune immagini citate nel Markdown non sono state trovate nel pacchetto.',
  'warning.REMOTE_IMAGES_BLOCKED':
    'Le immagini remote (Internet) non sono state scaricate, per proteggere la privacy.',
  'warning.NO_TEXT_EXTRACTED':
    'Nessun testo estratto: il PDF potrebbe essere una scansione. Prova con l’OCR.',
  'warning.IMAGES_SKIPPED': 'Alcune immagini sono state omesse per limiti di dimensione o numero.',
  'warning.LAYOUT_NOT_PRESERVED': "L'impaginazione originale del PDF non è stata conservata.",

  'diagnostics.title': 'Diagnostica',
  'diagnostics.open': 'Diagnostica',
  'diagnostics.close': 'Chiudi diagnostica',
  'diagnostics.refresh': 'Controlla di nuovo',
  'diagnostics.loading': 'Controllo delle dipendenze in corso…',
  'diagnostics.available': 'Disponibile',
  'diagnostics.unavailable': 'Non disponibile',
  'diagnostics.version': 'Versione',
  'diagnostics.path': 'Percorso',
  'diagnostics.enables': 'Abilita',
  'diagnostics.languages': 'Lingue OCR installate',
  'diagnostics.install': 'Come installarlo',
  'diagnostics.problem.NOT_FOUND': 'Non trovato nel PATH né nel percorso configurato.',
  'diagnostics.problem.NOT_RUNNABLE': 'Trovato ma non si avvia correttamente.',
  'diagnostics.problem.VERSION_TOO_OLD':
    'Versione troppo vecchia (serve Pandoc 2.15 o successivo).',
  'diagnostics.capabilities': 'Conversioni disponibili',
  'diagnostics.ocrLanguagesUsable': 'Lingue OCR utilizzabili: {languages}',
  'diagnostics.none': 'nessuna',
  'diagnostics.checkedAt': 'Ultimo controllo: {time}',

  'tool.pandoc': 'Pandoc',
  'tool.libreoffice': 'LibreOffice',
  'tool.tesseract': 'Tesseract',
  'tool.ocrmypdf': 'OCRmyPDF',
  'feature.md-to-docx': 'Markdown → DOCX',
  'feature.md-to-pdf': 'Markdown → PDF',
  'feature.docx-to-md': 'DOCX → Markdown',
  'feature.docx-to-pdf': 'DOCX → PDF',
  'feature.pdf-to-docx-simple': 'PDF → DOCX (semplice)',
  'feature.pdf-to-docx-high-fidelity': 'PDF → DOCX (alta fedeltà)',
  'feature.ocr': 'OCR dei PDF',

  'install.windows.pandoc': 'winget install --id JohnMacFarlane.Pandoc',
  'install.windows.libreoffice': 'winget install --id TheDocumentFoundation.LibreOffice',
  'install.windows.tesseract':
    'winget install --id UB-Mannheim.TesseractOCR (aggiungi la lingua italiana durante l’installazione)',
  'install.windows.ocrmypdf':
    'Su Windows è consigliato Docker Desktop o WSL2 (vedi docs/install-windows.md).',
  'install.macos.pandoc': 'brew install pandoc',
  'install.macos.libreoffice': 'brew install --cask libreoffice',
  'install.macos.tesseract': 'brew install tesseract tesseract-lang',
  'install.macos.ocrmypdf': 'brew install ocrmypdf',
  'install.linux.pandoc': 'sudo apt install pandoc',
  'install.linux.libreoffice':
    'sudo apt install --no-install-recommends libreoffice-writer-nogui libreoffice-draw-nogui',
  'install.linux.tesseract': 'sudo apt install tesseract-ocr tesseract-ocr-ita tesseract-ocr-eng',
  'install.linux.ocrmypdf': 'sudo apt install ocrmypdf',
  'install.other': 'Vedi README, sezione Installazione.',

  'units.bytes': '{value} B',
  'units.kb': '{value} KB',
  'units.mb': '{value} MB',
  'units.gb': '{value} GB',
} as const;

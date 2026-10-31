# Installazione nativa su Windows

Testata su Windows 11. I comandi vanno eseguiti in **PowerShell**.

> Se ti serve l'OCR, la strada più semplice su Windows è **Docker Desktop** (vedi
> [docker.md](docker.md)): OCRmyPDF richiede Python, Ghostscript e Tesseract configurati
> insieme, ed è fragile da installare nativamente.

## 1. Node.js e pnpm

```powershell
winget install --id OpenJS.NodeJS.LTS
```

Chiudi e riapri PowerShell, poi:

```powershell
node --version
```

Deve essere 22.13 o successivo. Installa pnpm:

```powershell
npm install -g pnpm@10
```

## 2. Pandoc (Markdown ↔ DOCX, PDF → DOCX semplice)

```powershell
winget install --id JohnMacFarlane.Pandoc
```

```powershell
pandoc --version
```

## 3. LibreOffice (DOCX → PDF, Markdown → PDF, PDF → DOCX alta fedeltà)

```powershell
winget install --id TheDocumentFoundation.LibreOffice
```

LibreOffice di solito **non** viene aggiunto al PATH. Il backend lo cerca automaticamente in
`C:\Program Files\LibreOffice\program\`. Per verificare:

```powershell
& "C:\Program Files\LibreOffice\program\soffice.com" --version
```

Il backend usa `soffice.com` (la versione "console" che scrive l'output e attende la fine) invece
di `soffice.exe`. Se lo hai installato altrove, indica il percorso in `.env`:

```
LIBREOFFICE_PATH=D:\Programmi\LibreOffice\program\soffice.com
```

## 4. Tesseract (facoltativo, per l'OCR)

```powershell
winget install --id UB-Mannheim.TesseractOCR
```

Durante l'installazione seleziona le lingue **Italian** e **English** in "Additional language
data". Verifica:

```powershell
& "C:\Program Files\Tesseract-OCR\tesseract.exe" --list-langs
```

## 5. OCRmyPDF (facoltativo, per l'OCR) — limitazioni

OCRmyPDF è un programma Python che richiede anche **Ghostscript** e Tesseract nel PATH. Su
Windows è supportato ma con limitazioni (prestazioni inferiori, configurazione manuale):

```powershell
winget install --id Python.Python.3.12
winget install --id ArtifexSoftware.GhostScript
py -m pip install --user ocrmypdf
```

Aggiungi al PATH la cartella degli script Python (`%APPDATA%\Python\Python312\Scripts`), la
cartella di Tesseract e `C:\Program Files\gs\gs<versione>\bin`, poi verifica:

```powershell
ocrmypdf --version
```

Se qualcosa non funziona, usa Docker Desktop o WSL2 (Ubuntu): in WSL2 puoi seguire la
[guida Linux](install-linux.md) e aprire l'app dal browser di Windows su `http://127.0.0.1:8080`.

Nota: `ocrmypdf` installato con pip crea `ocrmypdf.exe`. Il backend **rifiuta** volutamente file
`.cmd` o `.bat`, perché richiederebbero di avviare una shell.

## 5-bis. Installazione senza diritti di amministratore (verificata)

Procedura provata su Windows 11 con un utente **senza** privilegi di amministratore. Tutto va in
`%LOCALAPPDATA%\md-converter-tools`, niente viene installato per tutto il sistema.

1. **Pandoc**, installazione per utente (finisce in `%LOCALAPPDATA%\Pandoc`, trovato in automatico):

   ```powershell
   winget install --id JohnMacFarlane.Pandoc --scope user
   ```

2. **LibreOffice**: l'MSI si installa solo per tutto il sistema, ma si può **estrarre** con
   un'installazione amministrativa, che non richiede elevazione:

   ```powershell
   $tools = "$env:LOCALAPPDATA\md-converter-tools"
   winget download --id TheDocumentFoundation.LibreOffice --download-directory "$tools\downloads"
   $msi = (Get-ChildItem "$tools\downloads\*.msi")[0].FullName
   Start-Process msiexec.exe -Wait -ArgumentList '/a', "`"$msi`"", '/qn', "TARGETDIR=`"$tools\libreoffice`""
   ```

3. **Tesseract**: l'installer richiede l'amministratore, ma si può estrarre con 7-Zip; la lingua
   italiana si scarica dal repository ufficiale `tesseract-ocr/tessdata_fast`:

   ```powershell
   winget download --id UB-Mannheim.TesseractOCR --download-directory "$tools\downloads\tesseract"
   & "C:\Program Files\7-Zip\7z.exe" x -y "-o$tools\tesseract" "$tools\downloads\tesseract\*.exe"
   Invoke-WebRequest https://github.com/tesseract-ocr/tessdata_fast/raw/main/ita.traineddata -OutFile "$tools\tesseract\tessdata\ita.traineddata"
   ```

4. **OCRmyPDF** per utente. Dalla versione 17 usa pypdfium2 e **non richiede Ghostscript**:

   ```powershell
   py -m pip install --user ocrmypdf
   ```

5. Indica i percorsi in `.env`, nella radice del progetto:

   ```
   LIBREOFFICE_PATH=C:\Users\<utente>\AppData\Local\md-converter-tools\libreoffice\program\soffice.com
   TESSERACT_PATH=C:\Users\<utente>\AppData\Local\md-converter-tools\tesseract\tesseract.exe
   OCRMYPDF_PATH=C:\Users\<utente>\AppData\Roaming\Python\Python314\Scripts\ocrmypdf.exe
   ```

   Non serve aggiungere Tesseract al PATH: il backend passa a OCRmyPDF un PATH che contiene già la
   cartella del Tesseract configurato.

6. Verifica con `pnpm diagnose`: tutti e quattro gli strumenti devono risultare `[OK ]`.

## 6. Controllo del PATH

Per vedere dove Windows trova un programma:

```powershell
Get-Command pandoc, tesseract, ocrmypdf -ErrorAction SilentlyContinue | Select-Object Name, Source
```

Per vedere il PATH, una cartella per riga:

```powershell
$env:Path -split ';'
```

Dopo aver modificato il PATH (Impostazioni → Sistema → Informazioni → Impostazioni di sistema
avanzate → Variabili d'ambiente) **chiudi e riapri** il terminale.

## 7. Avvio

Dalla cartella del progetto:

```powershell
pnpm install
pnpm build
pnpm diagnose
pnpm start
```

Apri <http://127.0.0.1:8080>.

## Problemi tipici su Windows

- **Il primo avvio di Pandoc o LibreOffice è lento**: l'antivirus analizza gli eseguibili. Le
  conversioni successive sono più veloci.
- **`EBUSY` o file bloccati durante la pulizia**: l'antivirus può tenere aperti per qualche
  istante i file appena scritti; il backend riprova automaticamente la cancellazione.
- Altri casi: [troubleshooting.md](troubleshooting.md).

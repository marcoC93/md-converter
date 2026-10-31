# Estendere il convertitore

## Aggiungere una nuova conversione

Esempio: aggiungere l'uscita HTML da Markdown.

1. **Formato.** In `packages/shared/src/formats.ts` aggiungi `'html'` a `DOCUMENT_FORMATS`.
   L'interfaccia mostrerà la nuova opzione: aggiungi l'etichetta `'format.html'` in
   `apps/frontend/src/i18n/it.ts` (TypeScript segnala la chiave mancante).
2. **Pipeline.** In `apps/backend/src/conversion/pipelines/from-markdown.ts`:

   ```ts
   export async function markdownToHtml(context: PipelineContext): Promise<PipelineResult> {
     const prepared = await prepareMarkdownInput(
       context.inputPath,
       context.inputKind === 'markdown-bundle',
       context.workDir,
       context.limits.zipLimits,
     );
     const outputPath = path.join(context.outputDir, 'result.html');
     await runPandoc(
       context.executor,
       {
         from: markdownDialect(context.options.mode),
         to: 'html',
         inputPath: prepared.markdownPath,
         outputPath,
       },
       toolOptions(context),
     );
     return {
       outputPath,
       fileName: `${context.outputBaseName}.html`,
       isArchive: false,
       warnings: prepared.warnings,
     };
   }
   ```

   Regole da rispettare: scrivere solo in `context.workDir` e `context.outputDir`, passare sempre
   da un adapter in `src/tools/` (mai `spawn` diretto), usare `context.signal` e
   `context.timeoutMs`.

3. **Selezione.** In `apps/backend/src/conversion/pipeline-selector.ts` aggiungi il caso
   `from === 'markdown' && to === 'html'` con gli strumenti richiesti (`['pandoc']`).
4. **Diagnostica.** In `computeCapabilities()` (`src/diagnostics/dependency-checker.ts`) aggiungi
   la capacità, così l'interfaccia avvisa se manca lo strumento.
5. **Download.** In `src/routes/download-routes.ts` aggiungi il `Content-Type` per `.html`.
6. **Test.** Aggiungi il caso in `test/unit/jobs-core.test.ts` (`selectPipeline`) e un test in
   `test/integration/conversion-flow.test.ts` che verifichi gli argomenti passati a Pandoc.
7. **Documentazione.** Aggiorna [conversion-matrix.md](conversion-matrix.md).

## Aggiungere una lingua OCR

Esempio: tedesco (`deu`).

1. Installa i dati della lingua per Tesseract:
   - Debian/Ubuntu: `sudo apt install tesseract-ocr-deu`
   - macOS: già incluso in `brew install tesseract-lang`
   - Windows: rilancia l'installer di Tesseract e seleziona "German"
   - Docker: aggiungi `tesseract-ocr-deu` alla lista `apt-get install` in `docker/Dockerfile`
     e ricostruisci con `docker compose build`.
2. Consenti la lingua nel backend con la variabile `OCR_LANGUAGES`:

   ```
   OCR_LANGUAGES=ita,eng,deu
   ```

   (in Docker si imposta nell'ambiente: `OCR_LANGUAGES=ita,eng,deu docker compose up -d`).

3. Aggiungi l'etichetta per l'interfaccia in `apps/frontend/src/i18n/it.ts`:

   ```ts
   'language.deu': 'Tedesco',
   ```

   Senza etichetta l'interfaccia mostra il codice `deu`.

4. Riavvia e controlla nel pannello Diagnostica che `deu` compaia tra le "Lingue OCR
   utilizzabili". Una lingua compare solo se è sia consentita in `OCR_LANGUAGES` sia installata
   in Tesseract.

I codici sono quelli di Tesseract (3 lettere, eventualmente con variante: `chi_sim`). L'elenco
installato si vede con `tesseract --list-langs`.

## Aggiungere una lingua all'interfaccia

Esempio: inglese.

1. Crea `apps/frontend/src/i18n/en.ts`:

   ```ts
   import type { Messages } from './index';

   export const en: Messages = {
     'app.title': 'Document converter',
     // ... tutte le altre chiavi di it.ts
   };
   ```

   Il tipo `Messages` obbliga a fornire **tutte** le chiavi: `pnpm typecheck` segnala quelle
   mancanti.

2. Registra la lingua in `apps/frontend/src/i18n/index.ts`:

   ```ts
   const LOCALES = {
     it: { label: 'Italiano', messages: it as Messages },
     en: { label: 'English', messages: en },
   } satisfies Record<string, { label: string; messages: Messages }>;
   ```

3. Per cambiare lingua basta assegnare `locale.value = 'en'` (restituito da `useI18n()`): i
   componenti si aggiornano da soli perché usano sempre `t('chiave')`. Un selettore di lingua si
   può aggiungere accanto a `ThemeSwitcher.vue` con lo stesso schema.
4. Aggiorna anche l'attributo `lang` di `<html>` (`document.documentElement.lang = 'en'`) per le
   tecnologie assistive.

I messaggi d'errore arrivano dal backend come **codici** (`FILE_TOO_LARGE`...): il frontend li
traduce con le chiavi `error.<CODICE>`, quindi non serve tradurre nulla nel backend.

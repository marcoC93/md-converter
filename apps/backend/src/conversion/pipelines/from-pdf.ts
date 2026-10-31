import { rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ConversionMode } from '@md-converter/shared';
import { convertWithLibreOffice } from '../../tools/libreoffice.js';
import { runOcrmypdf } from '../../tools/ocrmypdf.js';
import { runPandoc } from '../../tools/pandoc.js';
import { finalizeMarkdownImages } from '../markdown-images.js';
import { writeMarkdownResult } from '../markdown-output.js';
import { convertPdfToMarkdown, type PdfToMarkdownResult } from '../pdf/pdf-to-markdown.js';
import { toolOptions, type PipelineContext, type PipelineResult } from '../pipeline-types.js';

/**
 * Se l'utente ha attivato l'OCR, crea un PDF intermedio con il livello di testo riconosciuto.
 * Il file resta nella directory di lavoro del job e viene cancellato con essa.
 */
async function preparePdf(context: PipelineContext): Promise<string> {
  const { ocr } = context.options;
  if (!ocr.enabled) return context.inputPath;
  context.reportProgress('ocr', null);
  const ocrPath = path.join(context.workDir, 'ocr.pdf');
  await runOcrmypdf(
    context.executor,
    {
      inputPath: context.inputPath,
      outputPath: ocrPath,
      languages: ocr.languages,
      force: ocr.force,
      jobs: context.limits.ocrJobs,
    },
    toolOptions(context),
  );
  return ocrPath;
}

async function extractMarkdown(
  context: PipelineContext,
  pdfPath: string,
  mode: ConversionMode,
): Promise<PdfToMarkdownResult> {
  context.reportProgress('extract', 0);
  return convertPdfToMarkdown(pdfPath, {
    mode,
    imagesDir: path.join(context.workDir, 'pdf-images'),
    imagesReference: 'pdf-images',
    signal: context.signal,
    onProgress: (percent) => context.reportProgress('extract', percent),
  });
}

export async function pdfToMarkdown(context: PipelineContext): Promise<PipelineResult> {
  const pdfPath = await preparePdf(context);
  const extracted = await extractMarkdown(context, pdfPath, context.options.mode);
  context.reportProgress('images', 95);
  return writeMarkdownResult(context, extracted.markdown, extracted.images, extracted.warnings);
}

/**
 * PDF → DOCX "strutturato": ricostruisce titoli, paragrafi ed elenchi tramite il Markdown
 * intermedio, poi Pandoc crea un DOCX pulito e modificabile. L'impaginazione originale si perde.
 */
export async function pdfToDocxSimple(context: PipelineContext): Promise<PipelineResult> {
  const pdfPath = await preparePdf(context);
  const extracted = await extractMarkdown(context, pdfPath, 'simple');
  // Immagini incorporate: Pandoc gira in sandbox e non leggerebbe file esterni.
  const finalized = await finalizeMarkdownImages(
    extracted.markdown,
    extracted.images,
    'embedded',
    Number.MAX_SAFE_INTEGER,
  );
  const intermediatePath = path.join(context.workDir, 'intermediate.md');
  await writeFile(intermediatePath, finalized.markdown, 'utf8');

  context.reportProgress('pandoc', 95);
  const outputPath = path.join(context.outputDir, 'result.docx');
  await runPandoc(
    context.executor,
    { from: 'gfm', to: 'docx', inputPath: intermediatePath, outputPath },
    toolOptions(context),
  );
  return {
    outputPath,
    fileName: `${context.outputBaseName}.docx`,
    isArchive: false,
    warnings: [...extracted.warnings, 'LAYOUT_NOT_PRESERVED'],
  };
}

/**
 * PDF → DOCX "visuale": LibreOffice apre il PDF con Writer e posiziona ogni riga in una cornice.
 * L'aspetto è vicino all'originale, ma il testo è difficile da modificare.
 */
export async function pdfToDocxHighFidelity(context: PipelineContext): Promise<PipelineResult> {
  const pdfPath = await preparePdf(context);
  context.reportProgress('libreoffice', null);
  const docxPath = await convertWithLibreOffice(
    context.executor,
    {
      inputPath: pdfPath,
      outputDir: path.join(context.workDir, 'libreoffice-out'),
      target: 'docx',
      pdfImport: true,
    },
    toolOptions(context),
  );
  const outputPath = path.join(context.outputDir, 'result.docx');
  await rename(docxPath, outputPath);
  return { outputPath, fileName: `${context.outputBaseName}.docx`, isArchive: false, warnings: [] };
}

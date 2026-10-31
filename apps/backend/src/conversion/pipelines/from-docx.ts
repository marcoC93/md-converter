import { readdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { convertWithLibreOffice } from '../../tools/libreoffice.js';
import { markdownDialect, runPandoc, SIMPLIFY_MARKDOWN_FILTER } from '../../tools/pandoc.js';
import type { ExtractedImage } from '../markdown-images.js';
import { writeMarkdownResult } from '../markdown-output.js';
import { toolOptions, type PipelineContext, type PipelineResult } from '../pipeline-types.js';

const MEDIA_DIR_NAME = 'media';

async function listFilesRecursively(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true }).catch(
    () => [],
  );
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/** DOCX → Markdown con Pandoc. Le immagini vengono estratte e poi rinominate o incorporate. */
export async function docxToMarkdown(context: PipelineContext): Promise<PipelineResult> {
  const convertedPath = path.join(context.workDir, 'converted.md');
  context.reportProgress('pandoc', null);
  await runPandoc(
    context.executor,
    {
      from: 'docx',
      to: markdownDialect(context.options.mode),
      inputPath: context.inputPath,
      outputPath: convertedPath,
      // Percorso relativo: i riferimenti nel Markdown saranno "media/...", senza percorsi assoluti.
      extractMediaDir: MEDIA_DIR_NAME,
      luaFilters: context.options.mode === 'simple' ? [SIMPLIFY_MARKDOWN_FILTER] : [],
    },
    toolOptions(context),
  );

  context.reportProgress('images', null);
  const markdown = await readFile(convertedPath, 'utf8');
  const mediaFiles = await listFilesRecursively(path.join(context.workDir, MEDIA_DIR_NAME));
  const images: ExtractedImage[] = mediaFiles.map((sourcePath) => ({
    sourcePath,
    referencePath: path.relative(context.workDir, sourcePath).split(path.sep).join('/'),
  }));
  return writeMarkdownResult(context, markdown, images, []);
}

/** DOCX → PDF con LibreOffice headless: conserva impaginazione, intestazioni e piè di pagina. */
export async function docxToPdf(context: PipelineContext): Promise<PipelineResult> {
  context.reportProgress('libreoffice', null);
  const pdfPath = await convertWithLibreOffice(
    context.executor,
    {
      inputPath: context.inputPath,
      outputDir: path.join(context.workDir, 'libreoffice-out'),
      target: 'pdf',
    },
    toolOptions(context),
  );
  const outputPath = path.join(context.outputDir, 'result.pdf');
  await rename(pdfPath, outputPath);
  return { outputPath, fileName: `${context.outputBaseName}.pdf`, isArchive: false, warnings: [] };
}

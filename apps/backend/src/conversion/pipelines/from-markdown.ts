import { rename } from 'node:fs/promises';
import path from 'node:path';
import { convertWithLibreOffice } from '../../tools/libreoffice.js';
import { markdownDialect, runPandoc } from '../../tools/pandoc.js';
import { prepareMarkdownInput } from '../markdown-bundle.js';
import { toolOptions, type PipelineContext, type PipelineResult } from '../pipeline-types.js';

/** Markdown → DOCX con Pandoc. Restituisce il percorso del DOCX e gli avvisi raccolti. */
async function markdownToDocxFile(context: PipelineContext, outputPath: string) {
  context.reportProgress('prepare', null);
  const prepared = await prepareMarkdownInput(
    context.inputPath,
    context.inputKind === 'markdown-bundle',
    context.workDir,
    context.limits.zipLimits,
  );
  context.reportProgress('pandoc', null);
  await runPandoc(
    context.executor,
    {
      from: markdownDialect(context.options.mode),
      to: 'docx',
      inputPath: prepared.markdownPath,
      outputPath,
    },
    toolOptions(context),
  );
  return prepared.warnings;
}

export async function markdownToDocx(context: PipelineContext): Promise<PipelineResult> {
  const outputPath = path.join(context.outputDir, 'result.docx');
  const warnings = await markdownToDocxFile(context, outputPath);
  return { outputPath, fileName: `${context.outputBaseName}.docx`, isArchive: false, warnings };
}

/** Markdown → DOCX (Pandoc) → PDF (LibreOffice): evita di dover installare LaTeX. */
export async function markdownToPdf(context: PipelineContext): Promise<PipelineResult> {
  const intermediateDocx = path.join(context.workDir, 'intermediate.docx');
  const warnings = await markdownToDocxFile(context, intermediateDocx);
  context.reportProgress('libreoffice', null);
  const pdfPath = await convertWithLibreOffice(
    context.executor,
    {
      inputPath: intermediateDocx,
      outputDir: path.join(context.workDir, 'libreoffice-out'),
      target: 'pdf',
    },
    toolOptions(context),
  );
  const outputPath = path.join(context.outputDir, 'result.pdf');
  await rename(pdfPath, outputPath);
  return { outputPath, fileName: `${context.outputBaseName}.pdf`, isArchive: false, warnings };
}

import {
  documentFormatOf,
  type ConversionOptions,
  type InputKind,
  type ToolId,
} from '@md-converter/shared';
import type { Pipeline } from './pipeline-types.js';
import { docxToMarkdown, docxToPdf } from './pipelines/from-docx.js';
import { markdownToDocx, markdownToPdf } from './pipelines/from-markdown.js';
import { pdfToDocxHighFidelity, pdfToDocxSimple, pdfToMarkdown } from './pipelines/from-pdf.js';

export interface PipelineDefinition {
  id: string;
  run: Pipeline;
  /** Strumenti esterni indispensabili (esclusi quelli per l'OCR, aggiunti a parte). */
  tools: ToolId[];
  /** La pipeline accetta l'OCR (solo con ingresso PDF). */
  supportsOcr: boolean;
}

const OCR_TOOLS: ToolId[] = ['ocrmypdf', 'tesseract'];

/** Sceglie la pipeline per ingresso, formato di uscita e modalità. Vedi docs/conversion-matrix.md. */
export function selectPipeline(
  inputKind: InputKind,
  options: Pick<ConversionOptions, 'outputFormat' | 'mode'>,
): PipelineDefinition | null {
  const from = documentFormatOf(inputKind);
  const to = options.outputFormat;
  const highFidelity = options.mode === 'high-fidelity';

  if (from === 'markdown' && to === 'docx')
    return { id: 'markdown-to-docx', run: markdownToDocx, tools: ['pandoc'], supportsOcr: false };
  if (from === 'markdown' && to === 'pdf')
    return {
      id: 'markdown-to-pdf',
      run: markdownToPdf,
      tools: ['pandoc', 'libreoffice'],
      supportsOcr: false,
    };
  if (from === 'docx' && to === 'markdown')
    return { id: 'docx-to-markdown', run: docxToMarkdown, tools: ['pandoc'], supportsOcr: false };
  if (from === 'docx' && to === 'pdf')
    return { id: 'docx-to-pdf', run: docxToPdf, tools: ['libreoffice'], supportsOcr: false };
  if (from === 'pdf' && to === 'markdown')
    return { id: 'pdf-to-markdown', run: pdfToMarkdown, tools: [], supportsOcr: true };
  if (from === 'pdf' && to === 'docx') {
    return highFidelity
      ? {
          id: 'pdf-to-docx-high-fidelity',
          run: pdfToDocxHighFidelity,
          tools: ['libreoffice'],
          supportsOcr: true,
        }
      : { id: 'pdf-to-docx-simple', run: pdfToDocxSimple, tools: ['pandoc'], supportsOcr: true };
  }
  return null;
}

/** Strumenti necessari tenendo conto dell'OCR richiesto. */
export function requiredTools(pipeline: PipelineDefinition, ocrEnabled: boolean): ToolId[] {
  return pipeline.supportsOcr && ocrEnabled ? [...pipeline.tools, ...OCR_TOOLS] : pipeline.tools;
}

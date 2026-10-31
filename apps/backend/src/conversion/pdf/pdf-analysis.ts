import type { PdfAnalysis } from '@md-converter/shared';
import { openPdf } from './pdf-document.js';

/** Sotto questa media di caratteri per pagina il PDF è probabilmente una scansione. */
export const MIN_CHARS_PER_PAGE = 20;
const MAX_SAMPLED_PAGES = 30;

export function isOcrSuggested(averageCharsPerPage: number): boolean {
  return averageCharsPerPage < MIN_CHARS_PER_PAGE;
}

/**
 * Stima quanto testo estraibile contiene il PDF, campionando al massimo le prime 30 pagine.
 * È un'indicazione: serve solo a suggerire l'OCR, non ad attivarlo.
 */
export async function analyzePdf(filePath: string): Promise<PdfAnalysis> {
  const { document, close } = await openPdf(filePath);
  try {
    const sampled = Math.min(document.numPages, MAX_SAMPLED_PAGES);
    let characters = 0;
    for (let pageNumber = 1; pageNumber <= sampled; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if ('str' in item) characters += item.str.replace(/\s+/g, '').length;
      }
      page.cleanup();
    }
    const averageCharsPerPage = sampled === 0 ? 0 : Math.round(characters / sampled);
    return {
      pageCount: document.numPages,
      averageCharsPerPage,
      ocrSuggested: isOcrSuggested(averageCharsPerPage),
    };
  } finally {
    await close();
  }
}

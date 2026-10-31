import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ConversionMode, WarningCode } from '@md-converter/shared';
import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { CancelledError } from '../../tools/tool-executor.js';
import type { ExtractedImage } from '../markdown-images.js';
import {
  escapeBlockStart,
  escapeMarkdownInline,
  markdownImage,
  markdownLink,
} from '../markdown-text.js';
import { openPdf } from './pdf-document.js';
import { extractPageContent, type PageContent } from './pdf-extract.js';
import { encodePng, loadPdfImage } from './pdf-images.js';
import {
  applyCaptions,
  bodyFontSize,
  buildTextBlocks,
  findMarginLines,
  groupIntoLines,
  headingLevels,
  insertImages,
  mergeParagraphsAcrossPages,
  type Block,
  type Line,
  type Segment,
} from './pdf-layout.js';

export interface PdfToMarkdownOptions {
  mode: ConversionMode;
  /** Directory assoluta in cui salvare le immagini estratte. */
  imagesDir: string;
  /** Prefisso relativo usato nei riferimenti Markdown (es. `pdf-images`). */
  imagesReference: string;
  signal: AbortSignal;
  onProgress?: (percent: number) => void;
  maxImages?: number;
}

export interface PdfToMarkdownResult {
  markdown: string;
  images: ExtractedImage[];
  warnings: WarningCode[];
}

/** Soglie per scartare le immagini decorative (linee, icone, sfondi). */
const MIN_IMAGE_SIDE = { simple: 48, 'high-fidelity': 8 } as const;
const BACKGROUND_COVERAGE = 0.8;
const DEFAULT_MAX_IMAGES = 500;

interface PageData {
  content: PageContent;
  lines: Line[];
  images: Array<Extract<Block, { kind: 'image' }>>;
}

class ImageCollector {
  readonly images: ExtractedImage[] = [];
  skippedForLimit = false;
  private readonly byObject = new Map<string, string | null>();

  constructor(private readonly options: PdfToMarkdownOptions) {}

  /** Salva l'immagine come PNG (una sola volta per oggetto) e restituisce il riferimento relativo. */
  async collect(page: PDFPageProxy, objectId: string): Promise<string | null> {
    const key = objectId.startsWith('g_') ? objectId : `${page.pageNumber}:${objectId}`;
    if (this.byObject.has(key)) return this.byObject.get(key) ?? null;

    let reference: string | null = null;
    if (this.images.length >= (this.options.maxImages ?? DEFAULT_MAX_IMAGES)) {
      this.skippedForLimit = true;
    } else {
      const decoded = await loadPdfImage(page, objectId);
      const minSide = MIN_IMAGE_SIDE[this.options.mode];
      const png =
        decoded && decoded.width >= minSide && decoded.height >= minSide
          ? encodePng(decoded)
          : null;
      if (png) {
        const fileName = `pdf-image-${String(this.images.length + 1).padStart(3, '0')}.png`;
        const sourcePath = path.join(this.options.imagesDir, fileName);
        await writeFile(sourcePath, png);
        reference = `${this.options.imagesReference}/${fileName}`;
        this.images.push({ sourcePath, referencePath: reference });
      }
    }
    this.byObject.set(key, reference);
    return reference;
  }
}

async function readPage(
  page: PDFPageProxy,
  collector: ImageCollector,
  mode: ConversionMode,
): Promise<PageData> {
  const content = await extractPageContent(page);
  const lines = groupIntoLines(content.fragments, content.pageNumber);
  const pageArea = content.width * content.height;
  const images: PageData['images'] = [];
  let imageNumber = 0;
  for (const image of content.images) {
    // Con l'OCR la pagina scansionata resta come immagine di sfondo: in modalità semplice basta il testo.
    const isBackground = lines.length > 0 && image.drawnArea >= pageArea * BACKGROUND_COVERAGE;
    if (mode === 'simple' && isBackground) continue;
    const reference = await collector.collect(page, image.objectId);
    if (!reference) continue;
    imageNumber++;
    images.push({
      kind: 'image',
      page: content.pageNumber,
      top: image.top,
      reference,
      alt: `Immagine ${imageNumber} a pagina ${content.pageNumber}`,
    });
  }
  return { content, lines, images };
}

function renderSegments(segments: readonly Segment[]): string {
  return segments
    .map((segment) =>
      segment.url ? markdownLink(segment.text, segment.url) : escapeMarkdownInline(segment.text),
    )
    .join('');
}

export function renderBlocks(blocks: readonly Block[]): string {
  const parts: string[] = [];
  blocks.forEach((block, index) => {
    let text: string;
    switch (block.kind) {
      case 'heading':
        text = `${'#'.repeat(block.level)} ${renderSegments(block.segments)}`;
        break;
      case 'paragraph':
        text = escapeBlockStart(renderSegments(block.segments));
        break;
      case 'list-item':
        text = `${block.marker} ${renderSegments(block.segments)}`;
        break;
      case 'image':
        text = markdownImage(block.alt, block.reference);
        break;
      case 'page-marker':
        text = `<!-- Pagina ${block.page} -->`;
        break;
    }
    // Le voci di uno stesso elenco vanno su righe consecutive, tutto il resto è separato da una riga vuota.
    const previous = blocks[index - 1];
    const separator =
      index === 0
        ? ''
        : block.kind === 'list-item' && previous?.kind === 'list-item'
          ? '\n'
          : '\n\n';
    parts.push(separator, text);
  });
  return `${parts.join('').trim()}\n`;
}

/**
 * Semplice: intestazioni e piè di pagina ripetuti vengono tolti.
 * Alta fedeltà: restano, ma spostati all'inizio e alla fine della pagina, dove si trovano visivamente.
 */
function orderPageLines(page: PageData, margin: ReadonlySet<Line>, mode: ConversionMode): Line[] {
  const body = page.lines.filter((line) => !margin.has(line));
  if (mode === 'simple') return body;
  const marginLines = page.lines.filter((line) => margin.has(line));
  const half = page.content.height / 2;
  return [
    ...marginLines.filter((line) => line.top < half),
    ...body,
    ...marginLines.filter((line) => line.top >= half),
  ];
}

/**
 * PDF → Markdown con pdf.js. Il risultato è un'approssimazione della struttura:
 * vedi docs/conversion-matrix.md per i limiti.
 */
export async function convertPdfToMarkdown(
  pdfPath: string,
  options: PdfToMarkdownOptions,
): Promise<PdfToMarkdownResult> {
  await mkdir(options.imagesDir, { recursive: true });
  const { document, close } = await openPdf(pdfPath);
  const collector = new ImageCollector(options);
  const pages: PageData[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      if (options.signal.aborted) throw new CancelledError();
      const page = await document.getPage(pageNumber);
      pages.push(await readPage(page, collector, options.mode));
      page.cleanup();
      options.onProgress?.(Math.round((pageNumber / document.numPages) * 90));
    }
  } finally {
    await close();
  }

  const margin = findMarginLines(
    pages.map((page) => ({ height: page.content.height, lines: page.lines })),
  );
  const contentLines = pages.flatMap((page) => page.lines.filter((line) => !margin.has(line)));
  const bodySize = bodyFontSize(contentLines);
  const levels = headingLevels(contentLines, bodySize);

  let blocks: Block[] = [];
  for (const page of pages) {
    const lines = orderPageLines(page, margin, options.mode);
    const pageBlocks = insertImages(buildTextBlocks(lines, bodySize, levels), page.images);
    if (options.mode === 'high-fidelity')
      blocks.push({ kind: 'page-marker', page: page.content.pageNumber, top: 0 });
    blocks.push(...pageBlocks);
  }
  applyCaptions(blocks);
  if (options.mode === 'simple') blocks = mergeParagraphsAcrossPages(blocks);

  const warnings: WarningCode[] = [];
  if (contentLines.length === 0) warnings.push('NO_TEXT_EXTRACTED');
  if (collector.skippedForLimit) warnings.push('IMAGES_SKIPPED');
  return {
    markdown: blocks.length > 0 ? renderBlocks(blocks) : '\n',
    images: collector.images,
    warnings,
  };
}

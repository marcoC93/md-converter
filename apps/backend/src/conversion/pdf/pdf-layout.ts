import type { TextFragment } from './pdf-extract.js';

/**
 * Euristiche per dedurre la struttura di un PDF dal solo aspetto del testo.
 * Sono funzioni pure (nessun accesso a file o a pdf.js) e quindi facili da testare.
 */

export interface Segment {
  text: string;
  url: string | null;
}

export interface Line {
  page: number;
  top: number;
  x: number;
  endX: number;
  fontSize: number;
  segments: Segment[];
}

export type Block =
  | {
      kind: 'heading';
      level: number;
      page: number;
      top: number;
      lastTop: number;
      fontSize: number;
      segments: Segment[];
    }
  | {
      kind: 'paragraph';
      page: number;
      top: number;
      lastTop: number;
      x: number;
      fontSize: number;
      segments: Segment[];
    }
  | {
      kind: 'list-item';
      marker: string;
      page: number;
      top: number;
      lastTop: number;
      x: number;
      fontSize: number;
      segments: Segment[];
    }
  | { kind: 'image'; page: number; top: number; reference: string; alt: string }
  | { kind: 'page-marker'; page: number; top: number };

const BULLET_PATTERN = /^\s*[•●○◦▪▫■□‣⁃∙·\-–—*]\s+/;
const NUMBERED_PATTERN = /^\s*(\d{1,3})[.)]\s+/;
const CAPTION_PATTERN = /^(figura|fig\.|figure|immagine|image|tabella|table)\s*\d+/i;
const PAGE_NUMBER_PATTERN = /^(?:pagina|pag\.|page|p\.)?\s*#(?:\s*(?:di|of|\/)\s*#)?$/;
const HEADING_SIZE_RATIO = 1.15;
const MAX_HEADING_LENGTH = 150;
const MAX_HEADING_LEVEL = 4;
const MARGIN_ZONE = 0.1;

export function lineText(segments: readonly Segment[]): string {
  return segments.map((segment) => segment.text).join('');
}

function appendSegment(segments: Segment[], text: string, url: string | null): void {
  const last = segments.at(-1);
  if (last && last.url === url) last.text += text;
  else segments.push({ text, url });
}

/**
 * Raggruppa i frammenti in righe. Si segue l'ordine del contenuto del PDF (di solito l'ordine
 * di lettura): un frammento continua la riga corrente se sta alla stessa altezza e più a destra.
 */
export function groupIntoLines(fragments: readonly TextFragment[], page: number): Line[] {
  const lines: Line[] = [];
  for (const fragment of fragments) {
    const current = lines.at(-1);
    const tolerance = Math.max(current?.fontSize ?? 0, fragment.fontSize) * 0.5;
    const sameLine =
      current !== undefined &&
      Math.abs(fragment.top - current.top) <= tolerance &&
      fragment.x >= current.endX - current.fontSize * 0.5;

    if (sameLine) {
      const previousText = current.segments.at(-1)?.text ?? '';
      const gap = fragment.x - current.endX;
      const needsSpace =
        gap > fragment.fontSize * 0.15 &&
        !previousText.endsWith(' ') &&
        !fragment.text.startsWith(' ');
      if (needsSpace)
        appendSegment(
          current.segments,
          ' ',
          current.segments.at(-1)?.url === fragment.url ? fragment.url : null,
        );
      appendSegment(current.segments, fragment.text, fragment.url);
      current.endX = Math.max(current.endX, fragment.x + fragment.width);
      current.fontSize = Math.max(current.fontSize, fragment.fontSize);
    } else {
      lines.push({
        page,
        top: fragment.top,
        x: fragment.x,
        endX: fragment.x + fragment.width,
        fontSize: fragment.fontSize,
        segments: [{ text: fragment.text, url: fragment.url }],
      });
    }
  }
  return lines
    .map((line) => ({ ...line, segments: normalizeSegments(line.segments) }))
    .filter((line) => line.segments.length > 0);
}

/** Comprime gli spazi multipli e toglie quelli iniziali e finali della riga. */
function normalizeSegments(segments: readonly Segment[]): Segment[] {
  const result = segments.map((segment) => ({
    ...segment,
    text: segment.text.replace(/\s+/g, ' '),
  }));
  if (result[0]) result[0].text = result[0].text.trimStart();
  const last = result.at(-1);
  if (last) last.text = last.text.trimEnd();
  return result.filter((segment) => segment.text.length > 0);
}

function normalizeForComparison(text: string): string {
  return text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

/**
 * Individua intestazioni e piè di pagina: righe nel 10% superiore o inferiore della pagina che
 * si ripetono su molte pagine (i numeri vengono ignorati, così "Pagina 1" e "Pagina 2" coincidono).
 */
export function findMarginLines(
  pages: ReadonlyArray<{ height: number; lines: readonly Line[] }>,
): Set<Line> {
  const margin = new Set<Line>();
  if (pages.length < 2) return margin;

  const inMarginZone = (line: Line, height: number) =>
    line.top < height * MARGIN_ZONE || line.top > height * (1 - MARGIN_ZONE);
  const pagesByText = new Map<string, Set<number>>();
  for (const page of pages) {
    for (const line of page.lines) {
      if (!inMarginZone(line, page.height)) continue;
      const key = normalizeForComparison(lineText(line.segments));
      const set = pagesByText.get(key) ?? new Set<number>();
      set.add(line.page);
      pagesByText.set(key, set);
    }
  }

  const threshold = pages.length >= 3 ? Math.max(3, Math.ceil(pages.length * 0.5)) : 2;
  for (const page of pages) {
    for (const line of page.lines) {
      if (!inMarginZone(line, page.height)) continue;
      const key = normalizeForComparison(lineText(line.segments));
      const repeated = (pagesByText.get(key)?.size ?? 0) >= threshold;
      if (repeated || PAGE_NUMBER_PATTERN.test(key)) margin.add(line);
    }
  }
  return margin;
}

const roundSize = (size: number) => Math.round(size * 2) / 2;

/** Dimensione del corpo del testo: quella usata dal maggior numero di caratteri. */
export function bodyFontSize(lines: readonly Line[]): number {
  const weights = new Map<number, number>();
  for (const line of lines) {
    const size = roundSize(line.fontSize);
    weights.set(size, (weights.get(size) ?? 0) + lineText(line.segments).length);
  }
  let best = 0;
  let bestWeight = -1;
  for (const [size, weight] of weights) {
    if (weight > bestWeight) {
      best = size;
      bestWeight = weight;
    }
  }
  return best;
}

function isHeadingCandidate(line: Line, bodySize: number): boolean {
  const text = lineText(line.segments);
  return (
    roundSize(line.fontSize) >= bodySize * HEADING_SIZE_RATIO && text.length <= MAX_HEADING_LENGTH
  );
}

/** Associa ogni dimensione "da titolo" a un livello: la più grande diventa `#`, la successiva `##`... */
export function headingLevels(lines: readonly Line[], bodySize: number): Map<number, number> {
  const sizes = [
    ...new Set(
      lines
        .filter((line) => isHeadingCandidate(line, bodySize))
        .map((line) => roundSize(line.fontSize)),
    ),
  ];
  sizes.sort((a, b) => b - a);
  return new Map(sizes.map((size, index) => [size, Math.min(index + 1, MAX_HEADING_LEVEL)]));
}

/** Unisce due righe dello stesso paragrafo, ricomponendo le parole spezzate con il trattino. */
function joinLine(target: Segment[], addition: readonly Segment[]): void {
  const last = target.at(-1);
  const first = addition[0];
  if (!last || !first) {
    target.push(...addition.map((segment) => ({ ...segment })));
    return;
  }
  if (/\p{L}-$/u.test(last.text) && /^\p{Ll}/u.test(first.text)) {
    last.text = last.text.slice(0, -1);
  } else {
    appendSegment(target, ' ', last.url === first.url ? first.url : null);
  }
  for (const segment of addition) appendSegment(target, segment.text, segment.url);
}

function stripPrefix(segments: readonly Segment[], prefixLength: number): Segment[] {
  const result = segments.map((segment) => ({ ...segment }));
  let remaining = prefixLength;
  while (remaining > 0 && result[0]) {
    const first = result[0];
    if (first.text.length <= remaining) {
      remaining -= first.text.length;
      result.shift();
    } else {
      first.text = first.text.slice(remaining);
      remaining = 0;
    }
  }
  return result;
}

function continuesBlock(block: Block | undefined, line: Line): boolean {
  if (!block || (block.kind !== 'paragraph' && block.kind !== 'list-item')) return false;
  if (block.page !== line.page) return false;
  const gap = line.top - block.lastTop;
  if (gap <= 0 || gap > line.fontSize * 1.6) return false;
  if (Math.abs(block.fontSize - line.fontSize) > 1.5) return false;
  return block.kind === 'paragraph' || line.x >= block.x - 1;
}

/** Trasforma le righe di una pagina in blocchi: titoli, paragrafi, voci di elenco. */
export function buildTextBlocks(
  lines: readonly Line[],
  bodySize: number,
  levels: ReadonlyMap<number, number>,
): Block[] {
  const blocks: Block[] = [];
  for (const line of lines) {
    const text = lineText(line.segments);
    const previous = blocks.at(-1);
    const level = isHeadingCandidate(line, bodySize)
      ? levels.get(roundSize(line.fontSize))
      : undefined;

    if (level !== undefined) {
      const mergeWithPrevious =
        previous?.kind === 'heading' &&
        previous.level === level &&
        previous.page === line.page &&
        line.top - previous.lastTop <= line.fontSize * 1.5;
      if (mergeWithPrevious) {
        joinLine(previous.segments, line.segments);
        previous.lastTop = line.top;
      } else {
        blocks.push({
          kind: 'heading',
          level,
          page: line.page,
          top: line.top,
          lastTop: line.top,
          fontSize: line.fontSize,
          segments: line.segments,
        });
      }
      continue;
    }

    const bullet = BULLET_PATTERN.exec(text);
    const numbered = bullet ? null : NUMBERED_PATTERN.exec(text);
    if (bullet || numbered) {
      const prefix = (bullet ?? numbered)![0];
      blocks.push({
        kind: 'list-item',
        marker: numbered ? `${numbered[1]}.` : '-',
        page: line.page,
        top: line.top,
        lastTop: line.top,
        x: line.x,
        fontSize: line.fontSize,
        segments: stripPrefix(line.segments, prefix.length),
      });
      continue;
    }

    if (
      continuesBlock(previous, line) &&
      (previous?.kind === 'paragraph' || previous?.kind === 'list-item')
    ) {
      joinLine(previous.segments, line.segments);
      previous.lastTop = line.top;
      continue;
    }
    blocks.push({
      kind: 'paragraph',
      page: line.page,
      top: line.top,
      lastTop: line.top,
      x: line.x,
      fontSize: line.fontSize,
      segments: line.segments,
    });
  }
  return blocks;
}

/** Inserisce ogni immagine subito dopo l'ultimo blocco di testo che si trova sopra di essa. */
export function insertImages(
  textBlocks: readonly Block[],
  images: ReadonlyArray<Extract<Block, { kind: 'image' }>>,
): Block[] {
  const result = [...textBlocks];
  for (const image of [...images].sort((a, b) => a.top - b.top)) {
    const lastAbove = result.findLastIndex(
      (block) =>
        block.page === image.page && block.kind !== 'page-marker' && block.top <= image.top,
    );
    if (lastAbove !== -1) {
      result.splice(lastAbove + 1, 0, image);
      continue;
    }
    const firstOnPage = result.findIndex(
      (block) => block.page === image.page && block.kind !== 'page-marker',
    );
    result.splice(firstOnPage === -1 ? result.length : firstOnPage, 0, image);
  }
  return result;
}

/** Usa la didascalia che segue un'immagine ("Figura 1: ...") come testo alternativo. */
export function applyCaptions(blocks: Block[]): void {
  blocks.forEach((block, index) => {
    const next = blocks[index + 1];
    if (block.kind !== 'image' || next?.kind !== 'paragraph') return;
    const caption = lineText(next.segments);
    if (CAPTION_PATTERN.test(caption)) block.alt = caption.slice(0, 200);
  });
}

/**
 * In modalità semplice un paragrafo spezzato dal cambio pagina viene ricomposto
 * se non termina con una punteggiatura di fine frase.
 */
export function mergeParagraphsAcrossPages(blocks: Block[]): Block[] {
  const result: Block[] = [];
  for (const block of blocks) {
    const previous = result.at(-1);
    if (
      previous?.kind === 'paragraph' &&
      block.kind === 'paragraph' &&
      block.page === previous.page + 1 &&
      Math.abs(block.fontSize - previous.fontSize) <= 1 &&
      !/[.!?:;]$/.test(lineText(previous.segments))
    ) {
      joinLine(previous.segments, block.segments);
      previous.page = block.page;
      previous.lastTop = block.lastTop;
      continue;
    }
    result.push(block);
  }
  return result;
}

import { OPS, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Un frammento di testo come lo restituisce pdf.js, con coordinate in punti PDF. */
export interface TextFragment {
  text: string;
  /** Coordinata x di inizio. */
  x: number;
  /** Linea di base, misurata dall'alto della pagina (più grande = più in basso). */
  top: number;
  width: number;
  fontSize: number;
  /** URL del link che copre il frammento, se esiste. */
  url: string | null;
}

export interface PageImage {
  /** Identificatore pdf.js: la stessa immagine disegnata più volte ha lo stesso id. */
  objectId: string;
  /** Bordo superiore dell'immagine disegnata, dall'alto della pagina. */
  top: number;
  /** Area occupata sulla pagina, in punti quadrati. */
  drawnArea: number;
}

export interface PageContent {
  pageNumber: number;
  width: number;
  height: number;
  fragments: TextFragment[];
  images: PageImage[];
}

interface LinkArea {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  url: string;
}

const ALLOWED_LINK_PROTOCOLS = ['http:', 'https:', 'mailto:'];
/** Quota minima del frammento coperta dal link perché lo consideriamo "testo del link". */
const LINK_COVERAGE_THRESHOLD = 0.6;

export function safeLinkUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    return ALLOWED_LINK_PROTOCOLS.includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

async function readLinks(page: PDFPageProxy): Promise<LinkArea[]> {
  const annotations = (await page.getAnnotations()) as Array<{
    subtype?: string;
    url?: unknown;
    rect?: number[];
  }>;
  const links: LinkArea[] = [];
  for (const annotation of annotations) {
    const url = safeLinkUrl(annotation.url);
    const rect = annotation.rect;
    if (annotation.subtype !== 'Link' || !url || !rect || rect.length !== 4) continue;
    const [ax = 0, ay = 0, bx = 0, by = 0] = rect;
    links.push({
      x1: Math.min(ax, bx),
      y1: Math.min(ay, by),
      x2: Math.max(ax, bx),
      y2: Math.max(ay, by),
      url,
    });
  }
  return links;
}

function linkFor(
  links: LinkArea[],
  x: number,
  baseline: number,
  width: number,
  fontSize: number,
): string | null {
  if (width <= 0) return null;
  const middle = baseline + fontSize / 3;
  for (const link of links) {
    if (middle < link.y1 || middle > link.y2) continue;
    const overlap = Math.min(x + width, link.x2) - Math.max(x, link.x1);
    if (overlap / width >= LINK_COVERAGE_THRESHOLD) return link.url;
  }
  return null;
}

async function readFragments(
  page: PDFPageProxy,
  pageTop: number,
  links: LinkArea[],
): Promise<TextFragment[]> {
  const content = await page.getTextContent();
  const fragments: TextFragment[] = [];
  for (const item of content.items) {
    if (!('str' in item) || item.str.length === 0) continue;
    const [, , c = 0, d = 0, x = 0, y = 0] = item.transform as number[];
    const fontSize = Math.hypot(c, d);
    if (fontSize <= 0) continue;
    fragments.push({
      text: item.str,
      x,
      top: pageTop - y,
      width: item.width,
      fontSize,
      url: linkFor(links, x, y, item.width, fontSize),
    });
  }
  return fragments;
}

type Matrix = [number, number, number, number, number, number];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/**
 * Trova le immagini disegnate sulla pagina seguendo la matrice di trasformazione (CTM):
 * un'immagine PDF viene disegnata nel quadrato unitario trasformato dalla CTM corrente.
 */
async function readImages(page: PDFPageProxy, pageTop: number): Promise<PageImage[]> {
  const operators = await page.getOperatorList();
  const images: PageImage[] = [];
  const stack: Matrix[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];

  operators.fnArray.forEach((fn, index) => {
    const args = operators.argsArray[index] as unknown[];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = multiply(ctm, args as Matrix);
    else if (fn === OPS.paintImageXObject && typeof args[0] === 'string') {
      const corners = [
        [ctm[4], ctm[5]],
        [ctm[0] + ctm[4], ctm[1] + ctm[5]],
        [ctm[2] + ctm[4], ctm[3] + ctm[5]],
        [ctm[0] + ctm[2] + ctm[4], ctm[1] + ctm[3] + ctm[5]],
      ];
      const ys = corners.map(([, y]) => y ?? 0);
      const xs = corners.map(([x]) => x ?? 0);
      images.push({
        objectId: args[0],
        top: pageTop - Math.max(...ys),
        drawnArea: (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)),
      });
    }
  });
  return images;
}

export async function extractPageContent(page: PDFPageProxy): Promise<PageContent> {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = page.view;
  const pageTop = Math.max(y1, y2);
  const links = await readLinks(page);
  return {
    pageNumber: page.pageNumber,
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
    fragments: await readFragments(page, pageTop, links),
    images: await readImages(page, pageTop),
  };
}

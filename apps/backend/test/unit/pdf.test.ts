import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzePdf } from '../../src/conversion/pdf/pdf-analysis.js';
import { safeLinkUrl, type TextFragment } from '../../src/conversion/pdf/pdf-extract.js';
import { encodePng } from '../../src/conversion/pdf/pdf-images.js';
import {
  bodyFontSize,
  buildTextBlocks,
  findMarginLines,
  groupIntoLines,
  headingLevels,
  insertImages,
  lineText,
} from '../../src/conversion/pdf/pdf-layout.js';
import { convertPdfToMarkdown } from '../../src/conversion/pdf/pdf-to-markdown.js';
import { createTempDir, fixturePath, removeDir } from '../helpers.js';

const fragment = (
  text: string,
  x: number,
  top: number,
  fontSize = 11,
  url: string | null = null,
): TextFragment => ({
  text,
  x,
  top,
  width: text.length * fontSize * 0.5,
  fontSize,
  url,
});

describe('euristiche di layout', () => {
  it('unisce i frammenti sulla stessa riga inserendo gli spazi', () => {
    const lines = groupIntoLines(
      [
        fragment('Ciao', 72, 100),
        fragment('mondo', 72 + 4 * 5.5 + 4, 100),
        fragment('Riga due', 72, 115),
      ],
      1,
    );
    expect(lines.map((line) => lineText(line.segments))).toEqual(['Ciao mondo', 'Riga due']);
  });

  it('riconosce titoli, elenchi e paragrafi', () => {
    const lines = groupIntoLines(
      [
        fragment('Titolo', 72, 50, 24),
        fragment('Sezione', 72, 90, 16),
        fragment('Primo paragrafo che va', 72, 120),
        fragment('a capo.', 72, 134),
        fragment('• voce uno', 72, 160),
        fragment('2) voce due', 72, 176),
      ],
      1,
    );
    const body = bodyFontSize(lines);
    const blocks = buildTextBlocks(lines, body, headingLevels(lines, body));
    expect(
      blocks.map((block) => (block.kind === 'heading' ? `h${block.level}` : block.kind)),
    ).toEqual(['h1', 'h2', 'paragraph', 'list-item', 'list-item']);
    const paragraph = blocks[2]!;
    expect('segments' in paragraph && lineText(paragraph.segments)).toBe(
      'Primo paragrafo che va a capo.',
    );
  });

  it('ricompone le parole spezzate dal trattino', () => {
    const lines = groupIntoLines(
      [fragment('una parola divisa con tratti-', 72, 100), fragment('no qui.', 72, 114)],
      1,
    );
    const blocks = buildTextBlocks(lines, 11, new Map());
    expect('segments' in blocks[0]! && lineText(blocks[0].segments)).toBe(
      'una parola divisa con trattino qui.',
    );
  });

  it('individua intestazioni e numeri di pagina ripetuti', () => {
    const pages = [1, 2, 3].map((page) => ({
      height: 842,
      lines: groupIntoLines(
        [
          fragment('Intestazione fissa', 72, 30),
          fragment('Contenuto diverso ' + page, 72, 400),
          fragment(`Pagina ${page} di 3`, 72, 820),
        ],
        page,
      ),
    }));
    const margin = findMarginLines(pages);
    const texts = [...margin].map((line) => lineText(line.segments));
    expect(texts).toContain('Intestazione fissa');
    expect(texts).toContain('Pagina 2 di 3');
    expect(texts.some((text) => text.startsWith('Contenuto'))).toBe(false);
  });

  it('inserisce le immagini dopo il testo che le precede', () => {
    const lines = groupIntoLines([fragment('Sopra', 72, 100), fragment('Sotto', 72, 400)], 1);
    const blocks = insertImages(buildTextBlocks(lines, 11, new Map()), [
      { kind: 'image', page: 1, top: 200, reference: 'i.png', alt: '' },
    ]);
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'image', 'paragraph']);
  });

  it('accetta solo link http, https e mailto', () => {
    expect(safeLinkUrl('https://example.org')).toBe('https://example.org/');
    expect(safeLinkUrl('mailto:a@example.org')).toBe('mailto:a@example.org');
    expect(safeLinkUrl('javascript:alert(1)')).toBeNull();
    expect(safeLinkUrl('file:///etc/passwd')).toBeNull();
  });
});

describe('encodePng', () => {
  it('converte pixel RGB e 1 bit in PNG', () => {
    expect(
      encodePng({ width: 2, height: 1, kind: 2, data: new Uint8Array([255, 0, 0, 0, 255, 0]) })
        ?.subarray(1, 4)
        .toString(),
    ).toBe('PNG');
    expect(
      encodePng({ width: 8, height: 1, kind: 1, data: new Uint8Array([0b10101010]) }),
    ).not.toBeNull();
  });

  it('scarta immagini enormi o con dati incompleti', () => {
    expect(
      encodePng({ width: 10_000, height: 10_000, kind: 2, data: new Uint8Array(3) }),
    ).toBeNull();
    expect(encodePng({ width: 4, height: 4, kind: 2, data: new Uint8Array(3) })).toBeNull();
  });
});

describe('PDF reali (fixture)', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await createTempDir();
  });
  afterAll(async () => removeDir(dir));

  it("analizza il testo e suggerisce l'OCR solo per la scansione", async () => {
    expect(await analyzePdf(fixturePath('text.pdf'))).toMatchObject({
      pageCount: 3,
      ocrSuggested: false,
    });
    expect(await analyzePdf(fixturePath('scanned.pdf'))).toMatchObject({
      pageCount: 1,
      ocrSuggested: true,
    });
  });

  it('rifiuta un PDF non valido', async () => {
    await expect(analyzePdf(fixturePath('fake.pdf'))).rejects.toMatchObject({
      code: 'INVALID_FILE_CONTENT',
    });
  });

  it('modalità semplice: struttura pulita, senza intestazioni ripetute', async () => {
    const result = await convertPdfToMarkdown(fixturePath('text.pdf'), {
      mode: 'simple',
      imagesDir: path.join(dir, 'simple'),
      imagesReference: 'pdf-images',
      signal: new AbortController().signal,
    });
    expect(result.markdown).toContain('# Rapporto di esempio');
    expect(result.markdown).toContain('## Obiettivi');
    expect(result.markdown).toContain('- riconoscere gli elenchi');
    expect(result.markdown).toContain('1. primo punto numerato');
    expect(result.markdown).toContain('trattino alla fine della riga');
    expect(result.markdown).toContain(
      '![Figura 1: gradiente di prova](pdf-images/pdf-image-001.png)',
    );
    expect(result.markdown).not.toContain('Documento di prova');
    expect(result.markdown).not.toContain('Pagina 2');
    expect(result.images).toHaveLength(1);
    expect(existsSync(result.images[0]!.sourcePath)).toBe(true);
  });

  it('alta fedeltà: conserva intestazioni e indica le pagine', async () => {
    const result = await convertPdfToMarkdown(fixturePath('text.pdf'), {
      mode: 'high-fidelity',
      imagesDir: path.join(dir, 'high'),
      imagesReference: 'pdf-images',
      signal: new AbortController().signal,
    });
    expect(result.markdown).toContain('<!-- Pagina 3 -->');
    expect(result.markdown).toContain('Documento di prova');
  });

  it("PDF scansionato senza OCR: avvisa che non c'è testo", async () => {
    const result = await convertPdfToMarkdown(fixturePath('scanned.pdf'), {
      mode: 'simple',
      imagesDir: path.join(dir, 'scan'),
      imagesReference: 'pdf-images',
      signal: new AbortController().signal,
    });
    expect(result.warnings).toContain('NO_TEXT_EXTRACTED');
    expect(result.images).toHaveLength(1);
  });

  it('si interrompe se annullato', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      convertPdfToMarkdown(fixturePath('text.pdf'), {
        mode: 'simple',
        imagesDir: path.join(dir, 'x'),
        imagesReference: 'p',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'CancelledError' });
  });
});

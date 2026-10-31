import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createBundleImageResolver,
  inlineLocalImages,
  prepareMarkdownInput,
} from '../../src/conversion/markdown-bundle.js';
import { finalizeMarkdownImages } from '../../src/conversion/markdown-images.js';
import {
  escapeBlockStart,
  escapeMarkdownInline,
  markdownImage,
  markdownLink,
} from '../../src/conversion/markdown-text.js';
import { createTempDir, fixturePath, removeDir } from '../helpers.js';

const zipLimits = {
  maxEntries: 100,
  maxTotalUncompressedBytes: 10 * 1024 * 1024,
  maxCompressionRatio: 200,
};

describe('escape Markdown', () => {
  it('neutralizza la formattazione ma lascia intatti gli URL', () => {
    expect(escapeMarkdownInline('a*b_c [x] https://example.org/a_b_c')).toBe(
      'a\\*b\\_c \\[x\\] https://example.org/a_b_c',
    );
  });

  it('evita che un paragrafo diventi titolo o elenco', () => {
    expect(escapeBlockStart('# non è un titolo')).toBe('\\# non è un titolo');
    expect(escapeBlockStart('2026. Un anno')).toBe('2026\\. Un anno');
    expect(escapeBlockStart('- trattino')).toBe('\\- trattino');
    expect(escapeBlockStart('Testo normale')).toBe('Testo normale');
  });

  it('costruisce link e immagini sicuri', () => {
    expect(markdownLink('sito', 'https://example.org/a(b)')).toBe(
      '[sito](https://example.org/a%28b%29)',
    );
    expect(markdownImage('alt [x]', 'images/a.png')).toBe('![alt \\[x\\]](images/a.png)');
  });
});

describe('inlineLocalImages', () => {
  const resolver = async (reference: string) =>
    reference === 'img/a.png' ? 'data:image/png;base64,AAA' : null;

  it('incorpora le immagini locali trovate', async () => {
    const result = await inlineLocalImages('![a](img/a.png "titolo")', resolver);
    expect(result.markdown).toBe('![a](data:image/png;base64,AAA "titolo")');
    expect(result.warnings).toEqual([]);
  });

  it('segnala immagini remote e mancanti senza modificarle', async () => {
    const markdown =
      '![r](https://example.org/x.png)\n\n![m](img/missing.png)\n\n<img src="http://evil/x.png">';
    const result = await inlineLocalImages(markdown, resolver);
    expect(result.markdown).toBe(markdown);
    expect(result.warnings.sort()).toEqual(['IMAGES_NOT_FOUND', 'REMOTE_IMAGES_BLOCKED']);
  });

  it('gestisce definizioni di riferimento e lascia stare i link normali', async () => {
    const markdown = '![a][logo]\n\n[logo]: img/a.png\n[doc]: altro/file.pdf\n';
    const result = await inlineLocalImages(markdown, resolver);
    expect(result.markdown).toContain('[logo]: data:image/png;base64,AAA');
    expect(result.markdown).toContain('[doc]: altro/file.pdf');
  });
});

describe('createBundleImageResolver', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await createTempDir();
    await mkdir(path.join(dir, 'bundle', 'docs'), { recursive: true });
    await mkdir(path.join(dir, 'bundle', 'images'), { recursive: true });
    await writeFile(path.join(dir, 'bundle', 'images', 'a.png'), 'PNG');
    await writeFile(path.join(dir, 'secret.png'), 'SECRET');
  });
  afterAll(async () => removeDir(dir));

  it('risolve immagini relative al file Markdown, anche con ../ interno', async () => {
    const resolve = createBundleImageResolver(
      path.join(dir, 'bundle'),
      path.join(dir, 'bundle', 'docs'),
      1024,
    );
    expect(await resolve('../images/a.png')).toBe(
      `data:image/png;base64,${Buffer.from('PNG').toString('base64')}`,
    );
  });

  it('non legge file fuori dal pacchetto né percorsi assoluti', async () => {
    const resolve = createBundleImageResolver(
      path.join(dir, 'bundle'),
      path.join(dir, 'bundle', 'docs'),
      1024,
    );
    expect(await resolve('../../secret.png')).toBeNull();
    expect(await resolve(path.join(dir, 'secret.png'))).toBeNull();
    expect(await resolve('C:/Windows/win.ini')).toBeNull();
  });
});

describe('prepareMarkdownInput', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await createTempDir();
  });
  afterAll(async () => removeDir(dir));

  it('estrae il pacchetto fixture e incorpora le immagini', async () => {
    const workDir = path.join(dir, 'work');
    await mkdir(workDir);
    const prepared = await prepareMarkdownInput(
      fixturePath('with-images.zip'),
      true,
      workDir,
      zipLimits,
    );
    const markdown = await readFile(prepared.markdownPath, 'utf8');
    expect(markdown.match(/data:image\/png;base64,/g)).toHaveLength(2);
    expect(markdown).toContain('https://example.org/immagine.png');
    expect(prepared.warnings).toEqual(['REMOTE_IMAGES_BLOCKED']);
  });
});

describe('finalizeMarkdownImages', () => {
  let dir: string;
  let first: string;
  let second: string;
  beforeAll(async () => {
    dir = await createTempDir();
    first = path.join(dir, 'rId1.png');
    second = path.join(dir, 'rId10.jpeg');
    await writeFile(first, Buffer.alloc(300, 1));
    await writeFile(second, Buffer.alloc(300, 2));
  });
  afterAll(async () => removeDir(dir));

  const markdown =
    'Prima ![b](media/rId10.jpeg) poi ![a](media/rId1.png) e di nuovo ![b](media/rId10.jpeg)';
  const images = () => [
    { sourcePath: first, referencePath: 'media/rId1.png' },
    { sourcePath: second, referencePath: 'media/rId10.jpeg' },
    { sourcePath: first, referencePath: 'media/unused.png' },
  ];

  it('rinomina in ordine di apparizione, senza collisioni tra prefissi', async () => {
    const result = await finalizeMarkdownImages(markdown, images(), 'separate', 1e9);
    expect(result.markdown).toBe(
      'Prima ![b](images/image-001.jpeg) poi ![a](images/image-002.png) e di nuovo ![b](images/image-001.jpeg)',
    );
    expect(result.imageFiles.map((file) => file.archivePath)).toEqual([
      'images/image-001.jpeg',
      'images/image-002.png',
    ]);
  });

  it('incorpora in Base64 entro il limite', async () => {
    const result = await finalizeMarkdownImages(markdown, images(), 'embedded', 1e9);
    expect(result.imageFiles).toEqual([]);
    expect(result.markdown).toContain('data:image/jpeg;base64,');
    expect(result.markdown).toContain('data:image/png;base64,');
  });

  it('oltre il limite torna alla cartella separata con un avviso', async () => {
    const result = await finalizeMarkdownImages(markdown, images(), 'embedded', 100);
    expect(result.warnings).toContain('EMBED_LIMIT_FALLBACK');
    expect(result.imageFiles).toHaveLength(2);
  });
});

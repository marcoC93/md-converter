import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  detectInputKind,
  isDeclaredMimeAccepted,
  validateFileContent,
} from '../../src/files/file-validation.js';
import { AppError } from '../../src/http/errors.js';
import {
  createTempDir,
  createZip,
  fixturePath,
  rawZipWithEntryName,
  removeDir,
} from '../helpers.js';

const limits = {
  maxEntries: 50,
  maxTotalUncompressedBytes: 10 * 1024 * 1024,
  maxCompressionRatio: 100,
};

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(AppError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe('detectInputKind', () => {
  it.each([
    ['a.md', 'markdown'],
    ['a.MARKDOWN', 'markdown'],
    ['a.zip', 'markdown-bundle'],
    ['a.docx', 'docx'],
    ['a.PDF', 'pdf'],
    ['a.doc', null],
    ['a.exe', null],
    ['pdf', null],
  ])('%s → %s', (name, kind) => {
    expect(detectInputKind(name)).toBe(kind);
  });
});

describe('isDeclaredMimeAccepted', () => {
  it('accetta i MIME coerenti o generici', () => {
    expect(isDeclaredMimeAccepted('pdf', 'application/pdf')).toBe(true);
    expect(isDeclaredMimeAccepted('markdown', '')).toBe(true);
    expect(isDeclaredMimeAccepted('markdown', 'text/markdown; charset=utf-8')).toBe(true);
  });

  it('rifiuta i MIME incoerenti', () => {
    expect(isDeclaredMimeAccepted('pdf', 'text/html')).toBe(false);
    expect(isDeclaredMimeAccepted('docx', 'application/x-msdownload')).toBe(false);
  });
});

describe('validateFileContent', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await createTempDir();
  });
  afterAll(async () => removeDir(dir));

  it('accetta le fixture valide', async () => {
    await validateFileContent(fixturePath('simple.md'), 'markdown', limits);
    await validateFileContent(fixturePath('text.pdf'), 'pdf', limits);
    await validateFileContent(fixturePath('simple.docx'), 'docx', limits);
    await validateFileContent(fixturePath('with-images.zip'), 'markdown-bundle', limits);
  });

  it('rifiuta un PDF falso', async () => {
    await expectCode(
      validateFileContent(fixturePath('fake.pdf'), 'pdf', limits),
      'INVALID_FILE_CONTENT',
    );
  });

  it('rifiuta un Markdown binario o non UTF-8', async () => {
    const binary = path.join(dir, 'binary.md');
    await writeFile(binary, Buffer.from([0x23, 0x20, 0x00, 0x01]));
    await expectCode(validateFileContent(binary, 'markdown', limits), 'INVALID_FILE_CONTENT');
    const latin1 = path.join(dir, 'latin1.md');
    await writeFile(latin1, Buffer.from([0x63, 0x69, 0x74, 0x74, 0xe0]));
    await expectCode(validateFileContent(latin1, 'markdown', limits), 'INVALID_FILE_CONTENT');
  });

  it('rifiuta uno ZIP qualunque spacciato per DOCX', async () => {
    const zip = path.join(dir, 'not-word.docx');
    await createZip(zip, [{ name: 'readme.txt', content: 'ciao' }]);
    await expectCode(validateFileContent(zip, 'docx', limits), 'INVALID_FILE_CONTENT');
  });

  it('rifiuta un PDF spacciato per DOCX', async () => {
    await expectCode(
      validateFileContent(fixturePath('text.pdf'), 'docx', limits),
      'INVALID_FILE_CONTENT',
    );
  });

  it('rifiuta archivi con percorsi ZIP Slip', async () => {
    const names = ['../evil.md', '/abs/evil.md', 'a/../../evil.md', 'C:/evil.md'];
    for (const [index, name] of names.entries()) {
      const zip = path.join(dir, `slip-${index}.zip`);
      await writeFile(zip, rawZipWithEntryName(name, '# x'));
      await expectCode(validateFileContent(zip, 'markdown-bundle', limits), 'UNSAFE_ARCHIVE');
    }
  });

  it('rifiuta una zip bomb (rapporto di compressione sospetto)', async () => {
    const zip = path.join(dir, 'bomb.zip');
    await createZip(zip, [
      { name: 'doc.md', content: '# x' },
      { name: 'zeros.png', content: Buffer.alloc(5 * 1024 * 1024) },
    ]);
    await expectCode(validateFileContent(zip, 'markdown-bundle', limits), 'UNSAFE_ARCHIVE');
  });

  it('rifiuta archivi con troppe voci', async () => {
    const zip = path.join(dir, 'many.zip');
    await createZip(
      zip,
      Array.from({ length: 60 }, (_, index) => ({ name: `f${index}.png`, content: 'x' })),
    );
    await expectCode(validateFileContent(zip, 'markdown-bundle', limits), 'UNSAFE_ARCHIVE');
  });

  it('richiede esattamente un file Markdown nel pacchetto', async () => {
    const none = path.join(dir, 'none.zip');
    await createZip(none, [{ name: 'a.png', content: 'x' }]);
    await expectCode(validateFileContent(none, 'markdown-bundle', limits), 'INVALID_FILE_CONTENT');
    const two = path.join(dir, 'two.zip');
    await createZip(two, [
      { name: 'a.md', content: '# a' },
      { name: 'b.md', content: '# b' },
    ]);
    await expectCode(validateFileContent(two, 'markdown-bundle', limits), 'INVALID_FILE_CONTENT');
  });
});

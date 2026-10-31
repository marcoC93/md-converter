import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import yauzl from 'yauzl';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractZip, inspectZip } from '../../src/files/zip-inspect.js';
import { writeZipFile } from '../../src/files/zip-writer.js';
import { createTempDir, createZip, rawZipWithEntryName, removeDir } from '../helpers.js';

const limits = {
  maxEntries: 100,
  maxTotalUncompressedBytes: 1024 * 1024,
  maxCompressionRatio: 100,
};

function listZipEntries(zipPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error);
      const names: string[] = [];
      zip.on('entry', (entry: yauzl.Entry) => {
        names.push(entry.fileName);
        zip.readEntry();
      });
      zip.on('end', () => resolve(names));
      zip.readEntry();
    });
  });
}

describe('ZIP', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await createTempDir();
  });
  afterAll(async () => removeDir(dir));

  it('estrae solo le voci richieste dentro la destinazione', async () => {
    const zip = path.join(dir, 'bundle.zip');
    await createZip(zip, [
      { name: 'doc.md', content: '# Titolo' },
      { name: 'images/a.png', content: 'png' },
      { name: 'script.sh', content: 'echo' },
    ]);
    const target = path.join(dir, 'out');
    const extracted = await extractZip(zip, target, limits, (name) => !name.endsWith('.sh'));
    expect(extracted.sort()).toEqual(['doc.md', 'images/a.png']);
    expect(await readFile(path.join(target, 'images', 'a.png'), 'utf8')).toBe('png');
    expect(existsSync(path.join(target, 'script.sh'))).toBe(false);
  });

  it('non scrive mai fuori dalla destinazione (ZIP Slip)', async () => {
    const zip = path.join(dir, 'slip.zip');
    await writeFile(zip, rawZipWithEntryName('../escaped.txt', 'pwned'));
    const target = path.join(dir, 'slip-out');
    await expect(extractZip(zip, target, limits, () => true)).rejects.toMatchObject({
      code: 'UNSAFE_ARCHIVE',
    });
    expect(existsSync(path.join(dir, 'escaped.txt'))).toBe(false);
  });

  it('rifiuta se la dimensione totale supera il limite', async () => {
    const zip = path.join(dir, 'big.zip');
    await createZip(zip, [{ name: 'a.md', content: Buffer.alloc(2 * 1024 * 1024, 'a') }]);
    await expect(inspectZip(zip, { ...limits, maxCompressionRatio: 1e9 })).rejects.toMatchObject({
      code: 'UNSAFE_ARCHIVE',
    });
  });

  it('crea archivi con i nomi indicati', async () => {
    const source = path.join(dir, 'source.txt');
    await writeFile(source, 'contenuto');
    const zip = path.join(dir, 'result.zip');
    await writeZipFile(zip, [
      { archivePath: 'doc.md', content: '# x' },
      { archivePath: 'images/image-001.png', filePath: source },
    ]);
    expect(await listZipEntries(zip)).toEqual(['doc.md', 'images/image-001.png']);
  });

  it('rifiuta nomi pericolosi in scrittura', async () => {
    await expect(
      writeZipFile(path.join(dir, 'bad.zip'), [{ archivePath: '../x', content: 'x' }]),
    ).rejects.toThrow();
  });
});

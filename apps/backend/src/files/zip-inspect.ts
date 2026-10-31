import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import yauzl from 'yauzl';
import { AppError } from '../http/errors.js';
import { isSafeRelativePath, resolveInside } from './safe-path.js';

export interface ZipLimits {
  maxEntries: number;
  maxTotalUncompressedBytes: number;
  /** Rapporto massimo tra dimensione decompressa e compressa per le voci grandi (anti zip-bomb). */
  maxCompressionRatio: number;
}

export interface ZipEntryInfo {
  name: string;
  isDirectory: boolean;
  compressedSize: number;
  uncompressedSize: number;
}

const RATIO_CHECK_MIN_BYTES = 1024 * 1024;

function openZip(filePath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    // lazyEntries: leggiamo una voce alla volta, senza caricare l'archivio in memoria.
    yauzl.open(
      filePath,
      { lazyEntries: true, autoClose: false, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip)
          reject(new AppError('INVALID_FILE_CONTENT', 'Archivio ZIP non leggibile.'));
        else resolve(zip);
      },
    );
  });
}

function forEachEntry(
  zip: yauzl.ZipFile,
  onEntry: (entry: yauzl.Entry) => Promise<void>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    zip.on('entry', (entry: yauzl.Entry) => {
      onEntry(entry).then(
        () => zip.readEntry(),
        (error: unknown) => reject(error),
      );
    });
    zip.on('end', () => resolve());
    // yauzl segnala qui anche i nomi pericolosi (assoluti o con "..").
    zip.on('error', () => reject(new AppError('UNSAFE_ARCHIVE', 'Archivio ZIP non valido.')));
    zip.readEntry();
  });
}

function checkEntry(
  entry: yauzl.Entry,
  limits: ZipLimits,
  totalSoFar: number,
  count: number,
): void {
  if (count > limits.maxEntries) {
    throw new AppError('UNSAFE_ARCHIVE', `L'archivio contiene più di ${limits.maxEntries} voci.`);
  }
  if (!isSafeRelativePath(entry.fileName)) {
    throw new AppError('UNSAFE_ARCHIVE', "L'archivio contiene percorsi non sicuri.");
  }
  if (totalSoFar + entry.uncompressedSize > limits.maxTotalUncompressedBytes) {
    throw new AppError('UNSAFE_ARCHIVE', "Il contenuto decompresso dell'archivio è troppo grande.");
  }
  const ratio = entry.uncompressedSize / Math.max(1, entry.compressedSize);
  if (entry.uncompressedSize > RATIO_CHECK_MIN_BYTES && ratio > limits.maxCompressionRatio) {
    throw new AppError('UNSAFE_ARCHIVE', 'Rapporto di compressione sospetto.');
  }
}

/** Elenca le voci di uno ZIP controllando nomi e dimensioni, senza estrarre nulla. */
export async function inspectZip(filePath: string, limits: ZipLimits): Promise<ZipEntryInfo[]> {
  const zip = await openZip(filePath);
  const entries: ZipEntryInfo[] = [];
  let total = 0;
  try {
    await forEachEntry(zip, async (entry) => {
      checkEntry(entry, limits, total, entries.length + 1);
      total += entry.uncompressedSize;
      entries.push({
        name: entry.fileName,
        isDirectory: entry.fileName.endsWith('/'),
        compressedSize: entry.compressedSize,
        uncompressedSize: entry.uncompressedSize,
      });
    });
  } finally {
    zip.close();
  }
  return entries;
}

/** Interrompe lo stream se i byte reali superano il limite (le dimensioni dichiarate possono mentire). */
function byteLimiter(maxBytes: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;
      if (seen > maxBytes)
        callback(new AppError('UNSAFE_ARCHIVE', 'Voce ZIP più grande del dichiarato.'));
      else callback(null, chunk);
    },
  });
}

/**
 * Estrae solo le voci accettate da `shouldExtract` dentro `destinationDir`.
 * Ogni percorso viene risolto con `resolveInside`, che impedisce lo ZIP Slip.
 */
export async function extractZip(
  filePath: string,
  destinationDir: string,
  limits: ZipLimits,
  shouldExtract: (entryName: string) => boolean,
): Promise<string[]> {
  const zip = await openZip(filePath);
  const extracted: string[] = [];
  let total = 0;
  let count = 0;
  try {
    await forEachEntry(zip, async (entry) => {
      count++;
      checkEntry(entry, limits, total, count);
      total += entry.uncompressedSize;
      if (entry.fileName.endsWith('/') || !shouldExtract(entry.fileName)) return;

      const target = resolveInside(destinationDir, entry.fileName);
      await mkdir(path.dirname(target), { recursive: true });
      const source = await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream)
            reject(new AppError('INVALID_FILE_CONTENT', 'Voce ZIP non leggibile.'));
          else resolve(stream);
        });
      });
      await pipeline(
        source,
        byteLimiter(entry.uncompressedSize),
        createWriteStream(target, { flags: 'wx' }),
      );
      extracted.push(entry.fileName.replaceAll('\\', '/'));
    });
  } finally {
    zip.close();
  }
  return extracted;
}

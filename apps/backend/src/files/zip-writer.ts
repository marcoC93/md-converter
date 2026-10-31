import { createWriteStream } from 'node:fs';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { isSafeRelativePath } from './safe-path.js';

export type ZipSource =
  { archivePath: string; filePath: string } | { archivePath: string; content: Buffer | string };

/**
 * Crea uno ZIP in streaming: i file vengono letti dal disco man mano che lo ZIP viene inviato,
 * senza costruire l'archivio completo in memoria.
 */
export function createZipStream(sources: readonly ZipSource[]): Readable {
  const zip = new yazl.ZipFile();
  for (const source of sources) {
    if (!isSafeRelativePath(source.archivePath)) {
      throw new Error('Nome non sicuro per una voce ZIP');
    }
    if ('filePath' in source) {
      zip.addFile(source.filePath, source.archivePath);
    } else {
      zip.addBuffer(Buffer.from(source.content), source.archivePath);
    }
  }
  zip.end();
  return zip.outputStream as Readable;
}

export async function writeZipFile(
  destinationPath: string,
  sources: readonly ZipSource[],
): Promise<void> {
  await pipeline(createZipStream(sources), createWriteStream(destinationPath));
}

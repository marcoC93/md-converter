import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../http/errors.js';

export interface IncomingFile {
  fileName: string;
  mimeType: string;
  /** Stream del contenuto. `truncated` è impostato da @fastify/multipart se si supera il limite. */
  stream: Readable & { truncated?: boolean };
}

/**
 * Salva l'upload su disco in streaming, contando i byte mentre arrivano.
 * Se il file supera `maxBytes` l'upload viene interrotto e il file parziale cancellato.
 */
export async function saveUpload(
  file: IncomingFile,
  destinationPath: string,
  maxBytes: number,
  errorCode: 'FILE_TOO_LARGE' | 'TOTAL_SIZE_EXCEEDED',
): Promise<number> {
  let received = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > maxBytes) callback(new AppError(errorCode));
      else callback(null, chunk);
    },
  });
  try {
    await pipeline(file.stream, counter, createWriteStream(destinationPath, { flags: 'wx' }));
    if (file.stream.truncated) throw new AppError('FILE_TOO_LARGE');
    return received;
  } catch (error) {
    await rm(destinationPath, { force: true });
    // Svuotiamo lo stream rimasto, altrimenti la richiesta HTTP resterebbe appesa.
    file.stream.resume();
    throw error;
  }
}

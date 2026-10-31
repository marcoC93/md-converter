import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { INPUT_EXTENSIONS, INPUT_KINDS, type InputKind } from '@md-converter/shared';
import { AppError } from '../http/errors.js';
import { splitExtension } from './sanitize-filename.js';
import { inspectZip, type ZipEntryInfo, type ZipLimits } from './zip-inspect.js';

/**
 * MIME dichiarati accettati. I browser inviano spesso `application/octet-stream` o niente
 * (soprattutto per `.md`), quindi il MIME è solo un primo filtro: la verifica vera è sul contenuto.
 */
const ACCEPTED_MIME_TYPES: Record<InputKind, readonly string[]> = {
  markdown: ['text/markdown', 'text/x-markdown', 'text/plain', 'application/octet-stream', ''],
  'markdown-bundle': [
    'application/zip',
    'application/x-zip-compressed',
    'application/x-zip',
    'multipart/x-zip',
    'application/octet-stream',
    '',
  ],
  docx: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
    'application/octet-stream',
    '',
  ],
  pdf: ['application/pdf', 'application/x-pdf', 'application/octet-stream', ''],
};

export const BUNDLE_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
const MARKDOWN_EXTENSIONS = INPUT_EXTENSIONS.markdown;
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const PDF_SIGNATURE = Buffer.from('%PDF-', 'latin1');
const PDF_SIGNATURE_SEARCH_BYTES = 1024;

export function detectInputKind(fileName: string): InputKind | null {
  const { extension } = splitExtension(fileName);
  return INPUT_KINDS.find((kind) => INPUT_EXTENSIONS[kind].includes(extension)) ?? null;
}

export function isDeclaredMimeAccepted(kind: InputKind, mimeType: string | undefined): boolean {
  const normalized = (mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return ACCEPTED_MIME_TYPES[kind].includes(normalized);
}

async function readFirstBytes(filePath: string, length: number): Promise<Buffer> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** File da ignorare nei pacchetti creati da macOS o da altri strumenti. */
function isIgnorableBundleEntry(name: string): boolean {
  return name.startsWith('__MACOSX/') || name.split('/').some((segment) => segment.startsWith('.'));
}

/** Trova l'unico file Markdown di un pacchetto; lancia un errore se ce ne sono zero o più di uno. */
export function findBundleMarkdownEntry(entries: readonly ZipEntryInfo[]): string {
  const markdownEntries = entries.filter(
    (entry) =>
      !entry.isDirectory &&
      !isIgnorableBundleEntry(entry.name) &&
      MARKDOWN_EXTENSIONS.includes(splitExtension(entry.name).extension),
  );
  if (markdownEntries.length !== 1) {
    throw new AppError(
      'INVALID_FILE_CONTENT',
      'Il pacchetto ZIP deve contenere esattamente un file .md (più eventuali immagini).',
    );
  }
  return markdownEntries[0]!.name;
}

export function isBundleImageEntry(name: string): boolean {
  return (
    !isIgnorableBundleEntry(name) &&
    BUNDLE_IMAGE_EXTENSIONS.includes(splitExtension(name).extension)
  );
}

async function assertUtf8Text(filePath: string): Promise<void> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    for await (const chunk of createReadStream(filePath)) {
      const buffer = chunk as Buffer;
      if (buffer.includes(0)) throw new Error('NUL byte');
      decoder.decode(buffer, { stream: true });
    }
    decoder.decode();
  } catch {
    throw new AppError(
      'INVALID_FILE_CONTENT',
      'Il file Markdown deve essere testo con codifica UTF-8.',
    );
  }
}

async function assertZipSignature(filePath: string): Promise<void> {
  const head = await readFirstBytes(filePath, ZIP_SIGNATURE.length);
  if (!head.equals(ZIP_SIGNATURE)) {
    throw new AppError('INVALID_FILE_CONTENT', 'Il file non è un archivio ZIP/DOCX valido.');
  }
}

/**
 * Controlla che il contenuto corrisponda al tipo dichiarato dall'estensione.
 * Lancia `AppError` con codici `INVALID_FILE_CONTENT` o `UNSAFE_ARCHIVE`.
 */
export async function validateFileContent(
  filePath: string,
  kind: InputKind,
  zipLimits: ZipLimits,
): Promise<void> {
  switch (kind) {
    case 'markdown':
      await assertUtf8Text(filePath);
      return;
    case 'pdf': {
      const head = await readFirstBytes(filePath, PDF_SIGNATURE_SEARCH_BYTES);
      if (!head.includes(PDF_SIGNATURE)) {
        throw new AppError('INVALID_FILE_CONTENT', 'Il file non contiene la firma di un PDF.');
      }
      return;
    }
    case 'docx': {
      await assertZipSignature(filePath);
      const names = new Set((await inspectZip(filePath, zipLimits)).map((entry) => entry.name));
      if (!names.has('[Content_Types].xml') || !names.has('word/document.xml')) {
        throw new AppError(
          'INVALID_FILE_CONTENT',
          'Il file non ha la struttura di un documento Word (.docx).',
        );
      }
      return;
    }
    case 'markdown-bundle': {
      await assertZipSignature(filePath);
      findBundleMarkdownEntry(await inspectZip(filePath, zipLimits));
      return;
    }
  }
}

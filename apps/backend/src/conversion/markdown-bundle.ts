import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { WarningCode } from '@md-converter/shared';
import { findBundleMarkdownEntry, isBundleImageEntry } from '../files/file-validation.js';
import { isPathInside } from '../files/safe-path.js';
import { extractZip, inspectZip, type ZipLimits } from '../files/zip-inspect.js';
import { imageMimeType } from './markdown-images.js';

const INLINE_IMAGE = /(!\[[^\]]*\]\(\s*)(<[^>\n]+>|[^\s)]+)/g;
const REFERENCE_DEFINITION = /^( {0,3}\[[^\]\n]+\]:[ \t]*)(<[^>\n]+>|\S+)/gm;
const HTML_IMAGE = /(<img\b[^>]*?\bsrc\s*=\s*["'])([^"']+)/gi;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export interface PreparedMarkdown {
  markdownPath: string;
  warnings: WarningCode[];
}

type ImageResolver = (reference: string) => Promise<string | null>;

function cleanReference(raw: string): string {
  return raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw;
}

function isRemote(reference: string): boolean {
  return (
    reference.startsWith('//') ||
    (SCHEME.test(reference) && !reference.toLowerCase().startsWith('data:'))
  );
}

/**
 * Sostituisce i riferimenti a immagini locali con data URI. Pandoc gira in `--sandbox` e non
 * leggerebbe file esterni: il backend lo fa al suo posto, ma solo dentro la directory del pacchetto.
 */
export async function inlineLocalImages(
  markdown: string,
  resolveImage: ImageResolver,
): Promise<{ markdown: string; warnings: WarningCode[] }> {
  const warnings = new Set<WarningCode>();
  const replacements = new Map<string, string | null>();

  const collect = async (raw: string, isImageContext: boolean) => {
    const reference = cleanReference(raw);
    if (replacements.has(raw) || reference.toLowerCase().startsWith('data:')) return;
    if (isRemote(reference)) {
      if (isImageContext) warnings.add('REMOTE_IMAGES_BLOCKED');
      replacements.set(raw, null);
      return;
    }
    const dataUri = await resolveImage(reference);
    if (!dataUri && isImageContext) warnings.add('IMAGES_NOT_FOUND');
    replacements.set(raw, dataUri);
  };

  for (const match of markdown.matchAll(INLINE_IMAGE)) await collect(match[2]!, true);
  for (const match of markdown.matchAll(HTML_IMAGE)) await collect(match[2]!, true);
  // Le definizioni di riferimento possono indicare anche link normali: le tocchiamo solo se puntano a un'immagine trovata.
  for (const match of markdown.matchAll(REFERENCE_DEFINITION)) {
    const reference = cleanReference(match[2]!);
    if (imageMimeType(reference.split(/[?#]/)[0] ?? '')) await collect(match[2]!, false);
  }

  const replace = (whole: string, prefix: string, raw: string) => {
    const replacement = replacements.get(raw);
    return replacement ? `${prefix}${replacement}` : whole;
  };
  const result = markdown
    .replace(INLINE_IMAGE, replace)
    .replace(HTML_IMAGE, replace)
    .replace(REFERENCE_DEFINITION, replace);
  return { markdown: result, warnings: [...warnings] };
}

/** Crea un resolver che legge immagini solo dentro `rootDir`, relative al file Markdown. */
export function createBundleImageResolver(
  rootDir: string,
  markdownDir: string,
  maxBytes: number,
): ImageResolver {
  return async (reference) => {
    let decoded: string;
    try {
      decoded = decodeURI(reference.split(/[?#]/)[0] ?? '');
    } catch {
      return null;
    }
    if (
      decoded.length === 0 ||
      path.isAbsolute(decoded) ||
      /^[a-zA-Z]:/.test(decoded) ||
      decoded.includes('\0')
    )
      return null;
    const resolved = path.resolve(markdownDir, decoded);
    const mime = imageMimeType(resolved);
    if (!mime || !isPathInside(rootDir, resolved)) return null;
    try {
      const info = await stat(resolved);
      if (!info.isFile() || info.size > maxBytes) return null;
      return `data:${mime};base64,${(await readFile(resolved)).toString('base64')}`;
    } catch {
      return null;
    }
  };
}

/**
 * Prepara il Markdown per Pandoc. Per un pacchetto ZIP estrae in modo sicuro il `.md` e le immagini,
 * poi incorpora le immagini locali. Per un `.md` singolo segnala soltanto le immagini non disponibili.
 */
export async function prepareMarkdownInput(
  inputPath: string,
  isBundle: boolean,
  workDir: string,
  zipLimits: ZipLimits,
): Promise<PreparedMarkdown> {
  const preparedPath = path.join(workDir, 'source.md');
  let markdown: string;
  let resolver: ImageResolver;

  if (isBundle) {
    const bundleDir = path.join(workDir, 'bundle');
    const markdownEntry = findBundleMarkdownEntry(await inspectZip(inputPath, zipLimits));
    await extractZip(
      inputPath,
      bundleDir,
      zipLimits,
      (name) => name === markdownEntry || isBundleImageEntry(name),
    );
    const markdownFile = path.join(bundleDir, markdownEntry);
    markdown = await readFile(markdownFile, 'utf8');
    resolver = createBundleImageResolver(
      bundleDir,
      path.dirname(markdownFile),
      zipLimits.maxTotalUncompressedBytes,
    );
  } else {
    markdown = await readFile(inputPath, 'utf8');
    resolver = async () => null;
  }

  const inlined = await inlineLocalImages(markdown, resolver);
  await writeFile(preparedPath, inlined.markdown, 'utf8');
  return { markdownPath: preparedPath, warnings: inlined.warnings };
}

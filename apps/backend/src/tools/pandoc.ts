import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConversionMode } from '@md-converter/shared';
import { toConversionError, type ToolExecutor, type ToolRunOptions } from './tool-executor.js';

/** Versione minima: `--sandbox` esiste da Pandoc 2.15. */
export const PANDOC_MIN_VERSION = [2, 15] as const;

const assetsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'assets',
  'pandoc',
);
export const SIMPLIFY_MARKDOWN_FILTER = path.join(assetsDir, 'simplify-markdown.lua');

export interface PandocArgsInput {
  from: string;
  to: string;
  inputPath: string;
  outputPath: string;
  /** Directory in cui Pandoc estrae le immagini contenute nel documento. */
  extractMediaDir?: string;
  luaFilters?: readonly string[];
}

/** Dialetto Markdown di Pandoc per ogni modalità (vedi docs/conversion-matrix.md). */
export function markdownDialect(mode: ConversionMode): string {
  return mode === 'simple' ? 'gfm' : 'markdown';
}

/**
 * Argomenti per Pandoc. `--sandbox` impedisce a Pandoc di leggere file non indicati o di
 * scaricare risorse dalla rete (es. immagini remote dentro un Markdown).
 */
export function buildPandocArgs(input: PandocArgsInput): string[] {
  const args = ['--sandbox', '--from', input.from, '--to', input.to, '--output', input.outputPath];
  if (input.to === 'gfm' || input.to.startsWith('markdown')) {
    args.push('--wrap=none');
  }
  if (input.from === 'docx') {
    args.push('--track-changes=accept');
  }
  if (input.extractMediaDir) {
    args.push(`--extract-media=${input.extractMediaDir}`);
  }
  for (const filter of input.luaFilters ?? []) {
    args.push('--lua-filter', filter);
  }
  // "--" indica la fine delle opzioni: il percorso del file non può essere scambiato per un'opzione.
  args.push('--', input.inputPath);
  return args;
}

export async function runPandoc(
  executor: ToolExecutor,
  input: PandocArgsInput,
  options: ToolRunOptions,
): Promise<void> {
  try {
    await executor('pandoc', buildPandocArgs(input), options);
  } catch (error) {
    throw toConversionError(error, 'pandoc');
  }
}

export function parsePandocVersion(output: string): string | null {
  return /^pandoc(?:\.exe)?\s+(\d+(?:\.\d+)+)/m.exec(output)?.[1] ?? null;
}

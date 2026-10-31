import os from 'node:os';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  TOOL_IDS,
  type ConversionCapability,
  type DiagnosticsReport,
  type ToolId,
  type ToolStatus,
} from '@md-converter/shared';
import type { AppConfig } from '../config.js';
import { buildChildEnv } from '../process/child-env.js';
import { runProcess } from '../process/process-runner.js';
import { resolveExecutable } from '../process/resolve-executable.js';
import { parseLibreOfficeVersion } from '../tools/libreoffice.js';
import { parseOcrmypdfVersion } from '../tools/ocrmypdf.js';
import { PANDOC_MIN_VERSION, parsePandocVersion } from '../tools/pandoc.js';
import { toolLookup } from '../tools/tool-catalog.js';
import {
  parseTesseractLanguages,
  parseTesseractVersion,
  TESSERACT_LIST_LANGS_ARGS,
} from '../tools/tesseract.js';

const VERSION_CHECK_TIMEOUT_MS = 30_000;

const TOOL_FEATURES: Record<ToolId, string[]> = {
  pandoc: ['md-to-docx', 'md-to-pdf', 'docx-to-md', 'pdf-to-docx-simple'],
  libreoffice: ['md-to-pdf', 'docx-to-pdf', 'pdf-to-docx-high-fidelity'],
  tesseract: ['ocr'],
  ocrmypdf: ['ocr'],
};

/** Esegue un comando di diagnostica e restituisce stdout + stderr (alcuni strumenti scrivono la versione su stderr). */
export type VersionProbe = (command: string, args: readonly string[]) => Promise<string>;

export interface DependencyCheckResult {
  report: DiagnosticsReport;
  /** Percorsi completi, solo per uso interno: non vengono mai inviati al browser. */
  paths: Record<ToolId, string | null>;
}

function createVersionProbe(workDir: string): VersionProbe {
  return async (command, args) => {
    await mkdir(path.join(workDir, 'tmp'), { recursive: true });
    const result = await runProcess({
      command,
      args,
      cwd: workDir,
      env: buildChildEnv(workDir),
      timeoutMs: VERSION_CHECK_TIMEOUT_MS,
      successExitCodes: [0, 1],
    });
    return `${result.stdout}\n${result.stderr}`;
  };
}

export function displayPath(fullPath: string, homeDir = os.homedir()): string {
  // Normalizzare le barre evita di mancare la home quando il percorso usa "/" su Windows.
  const normalizedPath = path.normalize(fullPath);
  const normalizedHome = homeDir ? path.normalize(homeDir) : '';
  if (normalizedHome && normalizedPath.toLowerCase().startsWith(normalizedHome.toLowerCase())) {
    return `~${normalizedPath.slice(normalizedHome.length)}`;
  }
  return normalizedPath;
}

function isVersionAtLeast(version: string, minimum: readonly number[]): boolean {
  const parts = version.split('.').map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < minimum.length; index++) {
    const actual = parts[index] ?? 0;
    const required = minimum[index] ?? 0;
    if (actual !== required) return actual > required;
  }
  return true;
}

function versionArgs(tool: ToolId, profileDir: string): string[] {
  if (tool === 'libreoffice') {
    return [`-env:UserInstallation=${pathToFileURL(profileDir).href}`, '--headless', '--version'];
  }
  return ['--version'];
}

function parseVersion(tool: ToolId, output: string): string | null {
  switch (tool) {
    case 'pandoc':
      return parsePandocVersion(output);
    case 'libreoffice':
      return parseLibreOfficeVersion(output);
    case 'tesseract':
      return parseTesseractVersion(output);
    case 'ocrmypdf':
      return parseOcrmypdfVersion(output);
  }
}

async function checkTool(
  tool: ToolId,
  config: Pick<AppConfig, 'toolPaths'>,
  probe: VersionProbe,
  profileDir: string,
): Promise<{ status: ToolStatus; path: string | null }> {
  const executable = await resolveExecutable(toolLookup(tool, config));
  const base: ToolStatus = {
    id: tool,
    available: false,
    version: null,
    displayPath: executable ? displayPath(executable) : null,
    enables: TOOL_FEATURES[tool],
    problem: null,
  };
  if (!executable) {
    return { status: { ...base, problem: 'NOT_FOUND' }, path: null };
  }

  let output: string;
  try {
    output = await probe(executable, versionArgs(tool, profileDir));
  } catch {
    return { status: { ...base, problem: 'NOT_RUNNABLE' }, path: null };
  }
  const version = parseVersion(tool, output);
  if (tool === 'pandoc' && version && !isVersionAtLeast(version, PANDOC_MIN_VERSION)) {
    return { status: { ...base, version, problem: 'VERSION_TOO_OLD' }, path: null };
  }
  const status: ToolStatus = { ...base, available: true, version };

  if (tool === 'tesseract') {
    try {
      status.languages = parseTesseractLanguages(
        await probe(executable, TESSERACT_LIST_LANGS_ARGS),
      );
    } catch {
      status.languages = [];
    }
  }
  return { status, path: executable };
}

export function computeCapabilities(
  available: Record<ToolId, boolean>,
  ocrLanguages: string[],
): ConversionCapability[] {
  const ocr = available.ocrmypdf && available.tesseract && ocrLanguages.length > 0;
  const both = available.pandoc && available.libreoffice;
  return [
    {
      from: 'markdown',
      to: 'docx',
      simple: available.pandoc,
      highFidelity: available.pandoc,
      ocr: false,
    },
    { from: 'markdown', to: 'pdf', simple: both, highFidelity: both, ocr: false },
    {
      from: 'docx',
      to: 'markdown',
      simple: available.pandoc,
      highFidelity: available.pandoc,
      ocr: false,
    },
    {
      from: 'docx',
      to: 'pdf',
      simple: available.libreoffice,
      highFidelity: available.libreoffice,
      ocr: false,
    },
    // PDF → Markdown usa pdf.js, incluso nel backend: è sempre disponibile.
    { from: 'pdf', to: 'markdown', simple: true, highFidelity: true, ocr },
    { from: 'pdf', to: 'docx', simple: available.pandoc, highFidelity: available.libreoffice, ocr },
  ];
}

function platformName(): DiagnosticsReport['platform'] {
  switch (process.platform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'macos';
    case 'linux':
      return 'linux';
    default:
      return 'other';
  }
}

/**
 * Controlla tutti gli strumenti in parallelo. `workDir` deve essere una directory di job valida
 * (gestita da TempStore) perché LibreOffice vi crea un profilo temporaneo.
 */
export async function checkDependencies(
  config: Pick<AppConfig, 'toolPaths' | 'allowedOcrLanguages'>,
  workDir: string,
  probe: VersionProbe = createVersionProbe(workDir),
): Promise<DependencyCheckResult> {
  const profileDir = path.join(workDir, 'libreoffice-profile');
  const results = await Promise.all(
    TOOL_IDS.map((tool) => checkTool(tool, config, probe, profileDir)),
  );

  const tools = results.map((result) => result.status);
  const paths = Object.fromEntries(
    results.map((result) => [result.status.id, result.path]),
  ) as Record<ToolId, string | null>;
  const available = Object.fromEntries(tools.map((tool) => [tool.id, tool.available])) as Record<
    ToolId,
    boolean
  >;
  const installedLanguages = tools.find((tool) => tool.id === 'tesseract')?.languages ?? [];
  const ocrLanguages = config.allowedOcrLanguages.filter((code) =>
    installedLanguages.includes(code),
  );

  return {
    report: {
      checkedAt: new Date().toISOString(),
      platform: platformName(),
      tools,
      capabilities: computeCapabilities(available, ocrLanguages),
      ocrLanguages,
    },
    paths,
  };
}

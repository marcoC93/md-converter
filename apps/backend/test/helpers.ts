import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_IDS, type DiagnosticsReport, type ToolId } from '@md-converter/shared';
import { createWriteStream } from 'node:fs';
import yazl from 'yazl';
import { loadConfig, type AppConfig } from '../src/config.js';
import {
  computeCapabilities,
  type DependencyCheckResult,
} from '../src/diagnostics/dependency-checker.js';
import { ProcessError, type ProcessResult } from '../src/process/process-runner.js';
import type { ToolExecutor } from '../src/tools/tool-executor.js';

export const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'tests',
  'fixtures',
  'files',
);

export function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

export async function createTempDir(prefix = 'md-converter-test'): Promise<string> {
  const dir = path.join(os.tmpdir(), `${prefix}-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

export function testConfig(tempDir: string, env: Record<string, string> = {}): AppConfig {
  return loadConfig({
    TEMP_DIR: tempDir,
    LOG_LEVEL: 'silent',
    FRONTEND_DIST_DIR: path.join(tempDir, 'no-frontend'),
    ...env,
  });
}

/** Diagnostica finta: tutti gli strumenti indicati risultano installati. */
export function fakeDependencyChecker(
  available: readonly ToolId[] = TOOL_IDS,
  ocrLanguages = ['ita', 'eng'],
) {
  return async (): Promise<DependencyCheckResult> => {
    const isAvailable = Object.fromEntries(
      TOOL_IDS.map((tool) => [tool, available.includes(tool)]),
    ) as Record<ToolId, boolean>;
    const report: DiagnosticsReport = {
      checkedAt: new Date().toISOString(),
      platform: 'linux',
      tools: TOOL_IDS.map((tool) => ({
        id: tool,
        available: isAvailable[tool],
        version: isAvailable[tool] ? '1.0' : null,
        displayPath: isAvailable[tool] ? `/fake/${tool}` : null,
        enables: [],
        problem: isAvailable[tool] ? null : 'NOT_FOUND',
        ...(tool === 'tesseract' ? { languages: ocrLanguages } : {}),
      })),
      capabilities: computeCapabilities(isAvailable, ocrLanguages),
      ocrLanguages: isAvailable.tesseract && isAvailable.ocrmypdf ? ocrLanguages : [],
    };
    const paths = Object.fromEntries(
      TOOL_IDS.map((tool) => [tool, isAvailable[tool] ? `/fake/${tool}` : null]),
    ) as Record<ToolId, string | null>;
    return { report, paths };
  };
}

export interface FakeToolCall {
  tool: ToolId;
  args: readonly string[];
  cwd: string;
}

export type FakeBehavior = 'success' | 'fail' | 'hang';

const OK_RESULT: ProcessResult = { exitCode: 0, stdout: '', stderr: '', durationMs: 1 };
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);

/**
 * Executor finto che imita gli effetti degli strumenti reali (scrive i file di output) senza
 * eseguirli. Registra le chiamate per verificarne gli argomenti.
 */
export function createFakeExecutor(behavior: Partial<Record<ToolId, FakeBehavior>> = {}) {
  const calls: FakeToolCall[] = [];
  const executor: ToolExecutor = async (tool, args, options) => {
    calls.push({ tool, args, cwd: options.cwd });
    const mode = behavior[tool] ?? 'success';
    if (mode === 'fail')
      throw new ProcessError('exit-code', 'failed', {
        ...OK_RESULT,
        exitCode: 1,
        stderr: 'secret document text',
      });
    if (mode === 'hang') {
      await new Promise<void>((_resolve, reject) => {
        const abort = () => reject(new ProcessError('cancelled', 'cancelled'));
        if (options.signal.aborted) abort();
        options.signal.addEventListener('abort', abort, { once: true });
      });
    }
    await simulateTool(tool, args, options.cwd);
    return OK_RESULT;
  };
  return { executor, calls };
}

async function simulateTool(tool: ToolId, args: readonly string[], cwd: string): Promise<void> {
  if (tool === 'pandoc') {
    const output = args[args.indexOf('--output') + 1]!;
    const extract = args.find((arg) => arg.startsWith('--extract-media='));
    if (output.endsWith('.md')) {
      let markdown = '# Documento\n\nTesto convertito.\n';
      if (extract) {
        const mediaDir = path.join(cwd, extract.split('=')[1]!, 'media');
        await mkdir(mediaDir, { recursive: true });
        await writeFile(path.join(mediaDir, 'image1.png'), TINY_PNG);
        markdown += '\n![Immagine](media/media/image1.png)\n';
      }
      await writeFile(output, markdown);
    } else {
      await writeFile(output, `fake ${path.extname(output)} from ${path.basename(args.at(-1)!)}`);
    }
  } else if (tool === 'libreoffice') {
    const outDir = args[args.indexOf('--outdir') + 1]!;
    const input = args.at(-1)!;
    const target = args[args.indexOf('--convert-to') + 1]!.split(':')[0]!;
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, `${path.parse(input).name}.${target}`), `fake ${target}`);
  } else if (tool === 'ocrmypdf') {
    await copyFile(args.at(-2)!, args.at(-1)!);
  }
}

/** Costruisce a mano un corpo multipart/form-data per `app.inject`. */
export function multipartPayload(
  fileName: string,
  content: Buffer | string,
  mimeType = 'application/octet-stream',
  fieldName = 'file',
) {
  const boundary = `----test${randomUUID()}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, Buffer.from(content), tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

export async function readFixture(name: string): Promise<Buffer> {
  return readFile(fixturePath(name));
}

/** Crea uno ZIP con voci arbitrarie (anche con nomi pericolosi, per i test di sicurezza). */
export function createZip(
  destination: string,
  entries: Array<{ name: string; content: Buffer | string }>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    for (const entry of entries) zip.addBuffer(Buffer.from(entry.content), entry.name);
    zip.end();
    zip.outputStream.pipe(createWriteStream(destination)).on('close', resolve).on('error', reject);
  });
}

/** Scrive manualmente uno ZIP minimo con un nome di voce arbitrario (yazl rifiuta i nomi pericolosi). */
export function rawZipWithEntryName(entryName: string, content = 'x'): Buffer {
  const name = Buffer.from(entryName, 'utf8');
  const data = Buffer.from(content);
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  const localRecord = Buffer.concat([local, name, data]);
  const centralRecord = Buffer.concat([central, name]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralRecord.length, 12);
  end.writeUInt32LE(localRecord.length, 16);
  return Buffer.concat([localRecord, centralRecord, end]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

import { chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checkDependencies,
  computeCapabilities,
  displayPath,
} from '../../src/diagnostics/dependency-checker.js';
import { resolveExecutable } from '../../src/process/resolve-executable.js';
import { createTempDir, removeDir } from '../helpers.js';

const isWindows = process.platform === 'win32';

describe('resolveExecutable', () => {
  let dir: string;
  let fakeTool: string;
  beforeAll(async () => {
    dir = await createTempDir();
    fakeTool = path.join(dir, isWindows ? 'faketool.exe' : 'faketool');
    await writeFile(fakeTool, 'binario finto');
    await chmod(fakeTool, 0o755);
    await writeFile(path.join(dir, 'script.cmd'), '@echo off');
  });
  afterAll(async () => removeDir(dir));

  it('trova un eseguibile nel PATH', async () => {
    expect(await resolveExecutable({ names: ['faketool'] }, dir)).toBe(fakeTool);
  });

  it('usa il percorso configurato', async () => {
    expect(await resolveExecutable({ configuredPath: fakeTool, names: ['altro'] }, '')).toBe(
      fakeTool,
    );
  });

  it('restituisce null se lo strumento manca', async () => {
    expect(await resolveExecutable({ names: ['inesistente'] }, dir)).toBeNull();
    expect(
      await resolveExecutable({ configuredPath: path.join(dir, 'nope'), names: [] }, dir),
    ).toBeNull();
  });

  it('ignora le directory relative del PATH', async () => {
    expect(await resolveExecutable({ names: ['faketool'] }, '.')).toBeNull();
  });

  it.skipIf(!isWindows)('su Windows rifiuta .cmd e .bat (richiederebbero una shell)', async () => {
    expect(
      await resolveExecutable({ configuredPath: path.join(dir, 'script.cmd'), names: [] }, dir),
    ).toBeNull();
  });
});

describe('checkDependencies', () => {
  let dir: string;
  const tools: Record<string, string> = {};
  beforeAll(async () => {
    dir = await createTempDir();
    for (const name of ['pandoc', 'soffice', 'tesseract', 'ocrmypdf']) {
      tools[name] = path.join(dir, isWindows ? `${name}.exe` : name);
      await writeFile(tools[name], 'x');
      await chmod(tools[name], 0o755);
    }
  });
  afterAll(async () => removeDir(dir));

  const versionOutputs: Record<string, string> = {
    pandoc: 'pandoc 3.1.11\n',
    soffice: 'LibreOffice 24.2.7.2 420(Build:2)\n',
    tesseract: 'tesseract 5.3.4\n',
    ocrmypdf: '16.10.0\n',
  };
  // Il probe finto risponde in base al nome dell'eseguibile, come farebbe lo strumento vero.
  const probe = async (command: string, args: readonly string[]) => {
    const name = path.parse(command).name;
    if (args.includes('--list-langs')) return 'List of available languages (3):\neng\nita\nosd\n';
    return versionOutputs[name] ?? '';
  };

  it('riporta versioni, lingue e capacità', async () => {
    const config = {
      toolPaths: {
        pandoc: tools.pandoc,
        libreoffice: tools.soffice,
        tesseract: tools.tesseract,
        ocrmypdf: tools.ocrmypdf,
      },
      allowedOcrLanguages: ['ita', 'eng', 'deu'],
    };
    const result = await checkDependencies(config, dir, probe);
    const byId = Object.fromEntries(result.report.tools.map((tool) => [tool.id, tool]));
    expect(byId.pandoc?.version).toBe('3.1.11');
    expect(byId.libreoffice?.version).toBe('24.2.7.2');
    expect(byId.tesseract?.languages).toEqual(['eng', 'ita']);
    expect(result.report.ocrLanguages).toEqual(['ita', 'eng']);
    expect(
      result.report.capabilities.every(
        (capability) => capability.simple && capability.ocr === (capability.from === 'pdf'),
      ),
    ).toBe(true);
  });

  it('segnala Pandoc troppo vecchio (manca --sandbox)', async () => {
    const config = { toolPaths: { pandoc: tools.pandoc }, allowedOcrLanguages: ['ita'] };
    const result = await checkDependencies(config, dir, async () => 'pandoc 2.9.2\n');
    const pandoc = result.report.tools.find((tool) => tool.id === 'pandoc');
    expect(pandoc).toMatchObject({ available: false, problem: 'VERSION_TOO_OLD' });
    expect(result.paths.pandoc).toBeNull();
  });

  it('segnala uno strumento che non si avvia', async () => {
    const config = { toolPaths: { pandoc: tools.pandoc }, allowedOcrLanguages: ['ita'] };
    const result = await checkDependencies(config, dir, async () => {
      throw new Error('spawn failed');
    });
    expect(result.report.tools.find((tool) => tool.id === 'pandoc')).toMatchObject({
      available: false,
      problem: 'NOT_RUNNABLE',
    });
  });

  it('non espone percorsi completi della home', async () => {
    const config = { toolPaths: { pandoc: tools.pandoc }, allowedOcrLanguages: ['ita'] };
    const result = await checkDependencies(config, dir, probe);
    expect(result.report.tools.find((tool) => tool.id === 'pandoc')?.displayPath).toBeTruthy();
  });
});

describe('computeCapabilities', () => {
  it('senza OCRmyPDF le conversioni normali restano disponibili', () => {
    const capabilities = computeCapabilities(
      { pandoc: true, libreoffice: true, tesseract: true, ocrmypdf: false },
      ['ita'],
    );
    expect(capabilities.every((capability) => capability.simple && capability.highFidelity)).toBe(
      true,
    );
    expect(capabilities.some((capability) => capability.ocr)).toBe(false);
  });

  it('PDF → Markdown funziona anche senza strumenti esterni', () => {
    const capabilities = computeCapabilities(
      { pandoc: false, libreoffice: false, tesseract: false, ocrmypdf: false },
      [],
    );
    expect(capabilities.find((c) => c.from === 'pdf' && c.to === 'markdown')).toMatchObject({
      simple: true,
      highFidelity: true,
    });
    expect(capabilities.find((c) => c.from === 'docx' && c.to === 'pdf')).toMatchObject({
      simple: false,
    });
  });
});

describe('displayPath', () => {
  it("abbrevia la home dell'utente", () => {
    expect(displayPath('/home/mario/bin/pandoc', '/home/mario')).toBe(
      `~${path.normalize('/bin/pandoc')}`,
    );
    expect(displayPath('/usr/bin/pandoc', '/home/mario')).toBe(path.normalize('/usr/bin/pandoc'));
  });
});

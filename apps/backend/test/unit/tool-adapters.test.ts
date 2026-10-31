import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildLibreOfficeArgs,
  libreOfficeOutputPath,
  parseLibreOfficeVersion,
} from '../../src/tools/libreoffice.js';
import {
  buildOcrmypdfArgs,
  mapOcrmypdfExitCode,
  parseOcrmypdfVersion,
} from '../../src/tools/ocrmypdf.js';
import { buildPandocArgs, markdownDialect, parsePandocVersion } from '../../src/tools/pandoc.js';
import { parseTesseractLanguages, parseTesseractVersion } from '../../src/tools/tesseract.js';
import { toConversionError } from '../../src/tools/tool-executor.js';
import { ProcessError } from '../../src/process/process-runner.js';

const input = path.resolve('/jobs/job-1/input/file.md');
const output = path.resolve('/jobs/job-1/output/result.docx');

describe('Pandoc', () => {
  it('usa sempre --sandbox e chiude le opzioni prima del file', () => {
    const args = buildPandocArgs({ from: 'gfm', to: 'docx', inputPath: input, outputPath: output });
    expect(args[0]).toBe('--sandbox');
    expect(args.slice(-2)).toEqual(['--', input]);
    expect(args).toContain(output);
  });

  it('aggiunge estrazione media, filtri e opzioni per DOCX → Markdown', () => {
    const args = buildPandocArgs({
      from: 'docx',
      to: 'gfm',
      inputPath: input,
      outputPath: output,
      extractMediaDir: 'media',
      luaFilters: ['/f.lua'],
    });
    expect(args).toEqual(
      expect.arrayContaining([
        '--extract-media=media',
        '--lua-filter',
        '/f.lua',
        '--wrap=none',
        '--track-changes=accept',
      ]),
    );
  });

  it('un nome di file malevolo resta un singolo argomento', () => {
    const evil = path.resolve('/jobs/x/"; rm -rf ~; echo ".md');
    const args = buildPandocArgs({ from: 'gfm', to: 'docx', inputPath: evil, outputPath: output });
    expect(args.at(-1)).toBe(evil);
  });

  it('sceglie il dialetto in base alla modalità', () => {
    expect(markdownDialect('simple')).toBe('gfm');
    expect(markdownDialect('high-fidelity')).toBe('markdown');
  });

  it('legge la versione', () => {
    expect(parsePandocVersion('pandoc 3.1.11.1\nFeatures: +server +lua')).toBe('3.1.11.1');
    expect(parsePandocVersion('pandoc.exe 3.13\n')).toBe('3.13');
    expect(parsePandocVersion('altro')).toBeNull();
  });
});

describe('LibreOffice', () => {
  it('usa un profilo dedicato in forma di URL file://', () => {
    const args = buildLibreOfficeArgs({
      profileDir: path.resolve('/w/profile'),
      inputPath: input,
      outputDir: path.resolve('/w/out'),
      target: 'pdf',
    });
    expect(args[0]).toMatch(/^-env:UserInstallation=file:\/\//);
    expect(args).toEqual(
      expect.arrayContaining(['--headless', '--convert-to', 'pdf:writer_pdf_Export', '--outdir']),
    );
    expect(args.at(-1)).toBe(input);
  });

  it('per PDF → DOCX usa il filtro di importazione di Writer', () => {
    const args = buildLibreOfficeArgs({
      profileDir: '/p',
      inputPath: '/i.pdf',
      outputDir: '/o',
      target: 'docx',
      pdfImport: true,
    });
    expect(args).toContain('--infilter=writer_pdf_import');
    expect(args).toContain('docx:MS Word 2007 XML');
  });

  it('calcola il nome del file prodotto', () => {
    expect(libreOfficeOutputPath('/a/b/input.docx', '/out', 'pdf')).toBe(
      path.join('/out', 'input.pdf'),
    );
  });

  it('legge la versione', () => {
    expect(parseLibreOfficeVersion('LibreOffice 24.8.4.2 480(Build:2)')).toBe('24.8.4.2');
  });
});

describe('OCRmyPDF', () => {
  it('usa --skip-text per impostazione predefinita e combina le lingue', () => {
    const args = buildOcrmypdfArgs({
      inputPath: '/i.pdf',
      outputPath: '/o.pdf',
      languages: ['ita', 'eng'],
      force: false,
      jobs: 2,
    });
    expect(args).toContain('--skip-text');
    expect(args).not.toContain('--force-ocr');
    expect(args).toEqual(expect.arrayContaining(['--language', 'ita+eng', '--jobs', '2']));
    expect(args.slice(-2)).toEqual(['/i.pdf', '/o.pdf']);
  });

  it("forza l'OCR solo se richiesto", () => {
    expect(
      buildOcrmypdfArgs({
        inputPath: '/i',
        outputPath: '/o',
        languages: ['ita'],
        force: true,
        jobs: 1,
      }),
    ).toContain('--force-ocr');
  });

  it('rifiuta codici lingua non validi (anti injection)', () => {
    expect(() =>
      buildOcrmypdfArgs({
        inputPath: '/i',
        outputPath: '/o',
        languages: ['ita;rm'],
        force: false,
        jobs: 1,
      }),
    ).toThrow();
    expect(() =>
      buildOcrmypdfArgs({
        inputPath: '/i',
        outputPath: '/o',
        languages: [],
        force: false,
        jobs: 1,
      }),
    ).toThrow();
  });

  it('traduce gli exit code documentati', () => {
    expect(mapOcrmypdfExitCode(8)).toBe('PDF_ENCRYPTED');
    expect(mapOcrmypdfExitCode(3)).toBe('DEPENDENCY_MISSING');
    expect(mapOcrmypdfExitCode(2)).toBe('CONVERSION_FAILED');
  });

  it('legge la versione', () => {
    expect(parseOcrmypdfVersion('16.10.4\n')).toBe('16.10.4');
  });
});

describe('Tesseract', () => {
  it('legge versione e lingue, escludendo osd', () => {
    expect(parseTesseractVersion('tesseract 5.5.0\n leptonica-1.84.1')).toBe('5.5.0');
    expect(parseTesseractVersion('tesseract v5.3.0.20221214')).toBe('5.3.0.20221214');
    const output =
      'List of available languages in "/usr/share/tessdata/" (4):\neng\nita\nosd\nchi_sim\n';
    expect(parseTesseractLanguages(output)).toEqual(['chi_sim', 'eng', 'ita']);
  });
});

describe('toConversionError', () => {
  it('non espone stderr nel messaggio', () => {
    const error = toConversionError(
      new ProcessError('exit-code', 'x', {
        exitCode: 1,
        stdout: '',
        stderr: 'contenuto riservato del documento',
        durationMs: 1,
      }),
      'pandoc',
    );
    expect(error.message).not.toContain('riservato');
    expect(error).toMatchObject({ code: 'CONVERSION_FAILED' });
  });

  it('mappa timeout e annullamento', () => {
    expect(toConversionError(new ProcessError('timeout', 'x'), 'pandoc')).toMatchObject({
      code: 'CONVERSION_TIMEOUT',
    });
    expect(toConversionError(new ProcessError('cancelled', 'x'), 'pandoc').name).toBe(
      'CancelledError',
    );
    expect(toConversionError(new ProcessError('spawn-failed', 'x'), 'pandoc')).toMatchObject({
      code: 'DEPENDENCY_MISSING',
    });
  });
});

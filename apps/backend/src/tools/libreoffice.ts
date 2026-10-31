import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AppError } from '../http/errors.js';
import { toConversionError, type ToolExecutor, type ToolRunOptions } from './tool-executor.js';

export type LibreOfficeTarget = 'pdf' | 'docx';

const OUTPUT_FILTERS: Record<LibreOfficeTarget, string> = {
  pdf: 'pdf:writer_pdf_Export',
  docx: 'docx:MS Word 2007 XML',
};

export interface LibreOfficeArgsInput {
  /** Profilo utente dedicato: due istanze con lo stesso profilo si bloccano a vicenda. */
  profileDir: string;
  inputPath: string;
  outputDir: string;
  target: LibreOfficeTarget;
  /** Apre il PDF con Writer (`writer_pdf_import`) invece che con Draw. */
  pdfImport?: boolean;
}

export function buildLibreOfficeArgs(input: LibreOfficeArgsInput): string[] {
  const args = [
    `-env:UserInstallation=${pathToFileURL(input.profileDir).href}`,
    '--headless',
    '--invisible',
    '--nologo',
    '--nodefault',
    '--norestore',
    '--nolockcheck',
  ];
  if (input.pdfImport) {
    args.push('--infilter=writer_pdf_import');
  }
  args.push(
    '--convert-to',
    OUTPUT_FILTERS[input.target],
    '--outdir',
    input.outputDir,
    input.inputPath,
  );
  return args;
}

/** LibreOffice chiama il risultato come l'input, con l'estensione del formato di arrivo. */
export function libreOfficeOutputPath(
  inputPath: string,
  outputDir: string,
  target: LibreOfficeTarget,
): string {
  return path.join(outputDir, `${path.parse(inputPath).name}.${target}`);
}

export async function convertWithLibreOffice(
  executor: ToolExecutor,
  input: Omit<LibreOfficeArgsInput, 'profileDir'>,
  options: ToolRunOptions,
): Promise<string> {
  const profileDir = path.join(options.cwd, 'libreoffice-profile');
  await mkdir(profileDir, { recursive: true });
  await mkdir(input.outputDir, { recursive: true });
  try {
    await executor('libreoffice', buildLibreOfficeArgs({ ...input, profileDir }), options);
  } catch (error) {
    throw toConversionError(error, 'libreoffice');
  }
  // LibreOffice può terminare con codice 0 anche quando non riesce a convertire: controlliamo il file.
  const outputPath = libreOfficeOutputPath(input.inputPath, input.outputDir, input.target);
  try {
    await access(outputPath);
  } catch {
    throw new AppError(
      'CONVERSION_FAILED',
      'LibreOffice non ha prodotto il documento. Il file potrebbe essere danneggiato.',
    );
  }
  return outputPath;
}

export function parseLibreOfficeVersion(output: string): string | null {
  return /LibreOffice\s+(\d+(?:\.\d+)+)/i.exec(output)?.[1] ?? null;
}

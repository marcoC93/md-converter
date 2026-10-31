import path from 'node:path';
import type { ToolId } from '@md-converter/shared';
import type { AppConfig } from '../config.js';
import type { ExecutableLookup } from '../process/resolve-executable.js';

function windowsProgramFiles(...segments: string[]): string[] {
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], 'C:\\Program Files'];
  return [...new Set(roots.filter((root): root is string => Boolean(root)))].map((root) =>
    path.win32.join(root, ...segments),
  );
}

/** Dove cercare ogni strumento. I percorsi cambiano tra Windows, macOS e Linux. */
export function toolLookup(tool: ToolId, config: Pick<AppConfig, 'toolPaths'>): ExecutableLookup {
  const configuredPath = config.toolPaths[tool];
  const platform = process.platform;
  switch (tool) {
    case 'pandoc':
      return {
        configuredPath,
        names: ['pandoc'],
        knownLocations:
          platform === 'win32'
            ? [
                ...windowsProgramFiles('Pandoc', 'pandoc.exe'),
                ...(process.env.LOCALAPPDATA
                  ? [path.win32.join(process.env.LOCALAPPDATA, 'Pandoc', 'pandoc.exe')]
                  : []),
              ]
            : ['/opt/homebrew/bin/pandoc', '/usr/local/bin/pandoc', '/usr/bin/pandoc'],
      };
    case 'libreoffice':
      return {
        configuredPath,
        // Su Windows `soffice.com` è la variante "console": scrive l'output e attende la fine.
        names: platform === 'win32' ? ['soffice.com', 'soffice.exe'] : ['soffice', 'libreoffice'],
        knownLocations:
          platform === 'win32'
            ? [
                ...windowsProgramFiles('LibreOffice', 'program', 'soffice.com'),
                ...windowsProgramFiles('LibreOffice', 'program', 'soffice.exe'),
              ]
            : platform === 'darwin'
              ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice']
              : ['/usr/bin/soffice', '/usr/lib/libreoffice/program/soffice'],
      };
    case 'tesseract':
      return {
        configuredPath,
        names: ['tesseract'],
        knownLocations:
          platform === 'win32'
            ? windowsProgramFiles('Tesseract-OCR', 'tesseract.exe')
            : ['/opt/homebrew/bin/tesseract', '/usr/local/bin/tesseract', '/usr/bin/tesseract'],
      };
    case 'ocrmypdf':
      return {
        configuredPath,
        names: ['ocrmypdf'],
        knownLocations:
          platform === 'win32'
            ? []
            : ['/opt/homebrew/bin/ocrmypdf', '/usr/local/bin/ocrmypdf', '/usr/bin/ocrmypdf'],
      };
  }
}

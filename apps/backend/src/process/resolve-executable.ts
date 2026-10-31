import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';

export interface ExecutableLookup {
  /** Percorso indicato dall'utente tramite variabile d'ambiente (es. `PANDOC_PATH`). */
  configuredPath?: string | undefined;
  /** Nomi da cercare nel PATH, in ordine di preferenza (es. `soffice.com`, `soffice`). */
  names: readonly string[];
  /** Percorsi assoluti tipici del sistema operativo, provati dopo il PATH. */
  knownLocations?: readonly string[];
}

const isWindows = process.platform === 'win32';
// Su Windows `.cmd` e `.bat` richiederebbero `shell: true`: non li accettiamo.
const WINDOWS_EXECUTABLE_EXTENSIONS = ['.exe', '.com'];

async function isExecutableFile(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    if (isWindows)
      return WINDOWS_EXECUTABLE_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function candidateFileNames(name: string): string[] {
  if (!isWindows || path.extname(name) !== '') return [name];
  return WINDOWS_EXECUTABLE_EXTENSIONS.map((extension) => `${name}${extension}`);
}

async function findInPath(name: string, pathVariable: string): Promise<string | null> {
  const directories = pathVariable
    .split(path.delimiter)
    .filter((dir) => dir.length > 0 && path.isAbsolute(dir));
  for (const directory of directories) {
    for (const fileName of candidateFileNames(name)) {
      const candidate = path.join(directory, fileName);
      if (await isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Restituisce il percorso assoluto di un eseguibile oppure `null`.
 * Ordine: percorso configurato → PATH → posizioni note. Le directory relative del PATH vengono
 * ignorate, così non si esegue per errore un programma presente nella directory corrente.
 */
export async function resolveExecutable(
  lookup: ExecutableLookup,
  pathVariable = process.env.PATH ?? process.env.Path ?? '',
): Promise<string | null> {
  if (lookup.configuredPath) {
    if (path.isAbsolute(lookup.configuredPath)) {
      return (await isExecutableFile(lookup.configuredPath)) ? lookup.configuredPath : null;
    }
    return findInPath(lookup.configuredPath, pathVariable);
  }
  for (const name of lookup.names) {
    const found = await findInPath(name, pathVariable);
    if (found) return found;
  }
  for (const location of lookup.knownLocations ?? []) {
    if (await isExecutableFile(location)) return location;
  }
  return null;
}

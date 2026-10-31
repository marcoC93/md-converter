import path from 'node:path';

/** Vero se `child` è uguale a `parent` o si trova al suo interno (dopo la risoluzione). */
export function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Controlla un percorso relativo proveniente da un input non attendibile (es. una voce ZIP).
 * Rifiuta percorsi assoluti, lettere di unità Windows, segmenti `..`, byte NUL e nomi vuoti:
 * sono i trucchi usati negli attacchi "ZIP Slip".
 */
export function isSafeRelativePath(entryPath: string): boolean {
  if (entryPath.length === 0 || entryPath.length > 1024) return false;
  if (entryPath.includes('\0')) return false;
  const normalized = entryPath.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return false;
  const segments = normalized.split('/').filter((segment, index, all) => {
    // Una barra finale indica una directory: l'ultimo segmento vuoto è ammesso.
    return !(segment === '' && index === all.length - 1);
  });
  return (
    segments.length > 0 &&
    segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
  );
}

/** Risolve `relativePath` dentro `baseDir` e lancia un errore se il risultato esce dalla base. */
export function resolveInside(baseDir: string, relativePath: string): string {
  if (!isSafeRelativePath(relativePath)) {
    throw new Error('Percorso relativo non sicuro');
  }
  const resolved = path.resolve(baseDir, relativePath.replaceAll('\\', '/'));
  if (!isPathInside(baseDir, resolved) || resolved === path.resolve(baseDir)) {
    throw new Error('Il percorso esce dalla directory consentita');
  }
  return resolved;
}

const MAX_FILE_NAME_LENGTH = 120;
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
// Caratteri vietati su Windows, separatori di percorso e caratteri di controllo (U+0000–U+001F, U+007F).
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;

export function splitExtension(fileName: string): { base: string; extension: string } {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return { base: fileName, extension: '' };
  return { base: fileName.slice(0, dot), extension: fileName.slice(dot).toLowerCase() };
}

/**
 * Rende un nome di file sicuro da usare nel `Content-Disposition` e dentro gli archivi ZIP.
 * Il nome originale non viene mai usato per scrivere sul disco del server.
 */
export function sanitizeFileName(rawName: string, fallback = 'documento'): string {
  // Il browser può inviare un percorso completo (es. C:\fakepath\file.pdf): teniamo solo l'ultima parte.
  const lastSegment = rawName.split(/[/\\]/).pop() ?? '';
  let name = lastSegment
    .normalize('NFC')
    .replace(FORBIDDEN_CHARACTERS, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');

  // Un nome come ".pdf" ha solo l'estensione: dopo la pulizia resterebbe "pdf".
  const onlyExtension = /^\.[a-z0-9]{1,16}$/i.exec(lastSegment.trim());
  if (onlyExtension) return `${fallback}${onlyExtension[0].toLowerCase()}`;

  let { base, extension } = splitExtension(name);
  if (WINDOWS_RESERVED_NAMES.test(base)) base = `_${base}`;
  if (extension.length > 16) extension = '';
  const maxBaseLength = MAX_FILE_NAME_LENGTH - extension.length;
  if (base.length > maxBaseLength) base = base.slice(0, maxBaseLength).trimEnd();
  name = `${base}${extension}`;

  return base.length === 0 ? `${fallback}${extension}` : name;
}

/** Restituisce un nome non ancora usato: `file.md`, `file (2).md`, `file (3).md`... */
export function uniqueFileName(fileName: string, usedNames: Set<string>): string {
  const { base, extension } = splitExtension(fileName);
  let candidate = fileName;
  for (let counter = 2; usedNames.has(candidate.toLowerCase()); counter++) {
    candidate = `${base} (${counter})${extension}`;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

/** Valore per `Content-Disposition`, con fallback ASCII e nome UTF-8 (RFC 6266 / RFC 5987). */
export function contentDisposition(fileName: string): string {
  const asciiFallback = fileName
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

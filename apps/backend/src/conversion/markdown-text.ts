const URL_PATTERN = /(https?:\/\/[^\s<>()]+)/;
const SPECIAL_CHARACTERS = /([\\`*_[\]<>|~])/g;
const BLOCK_START_PATTERN = /^(#{1,6}(?=\s|$)|[-+*](?=\s)|>|\d{1,9}[.)](?=\s|$)|={3,}|-{3,})/;

/**
 * Applica l'escape ai caratteri che Markdown interpreterebbe come formattazione.
 * Gli URL vengono lasciati intatti, così restano cliccabili (autolink GFM).
 */
export function escapeMarkdownInline(text: string): string {
  return text
    .split(URL_PATTERN)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(SPECIAL_CHARACTERS, '\\$1')))
    .join('');
}

/** Evita che un paragrafo che inizia con "1." o "#" diventi un elenco o un titolo. */
export function escapeBlockStart(text: string): string {
  const match = BLOCK_START_PATTERN.exec(text);
  if (!match) return text;
  const token = match[0];
  const numbered = /^(\d+)([.)])$/.exec(token);
  if (numbered) return `${numbered[1]}\\${numbered[2]}${text.slice(token.length)}`;
  return `\\${text}`;
}

/** URL sicuro per un link Markdown: le parentesi chiuderebbero il link in anticipo. */
export function markdownLinkTarget(url: string): string {
  return url.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\s/g, '%20');
}

export function markdownLink(text: string, url: string): string {
  return `[${escapeMarkdownInline(text)}](${markdownLinkTarget(url)})`;
}

export function markdownImage(alt: string, target: string): string {
  const safeAlt = alt
    .replace(/[[\]\\]/g, '\\$&')
    .replace(/\s+/g, ' ')
    .trim();
  return `![${safeAlt}](${target})`;
}

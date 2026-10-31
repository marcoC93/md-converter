/** Formati documentali gestiti dall'applicazione. */
export const DOCUMENT_FORMATS = ['markdown', 'docx', 'pdf'] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

/**
 * Tipo di file in ingresso. Un pacchetto Markdown è uno ZIP con un file `.md` e le sue
 * immagini: dal punto di vista della conversione resta Markdown.
 */
export const INPUT_KINDS = ['markdown', 'markdown-bundle', 'docx', 'pdf'] as const;
export type InputKind = (typeof INPUT_KINDS)[number];

export function documentFormatOf(kind: InputKind): DocumentFormat {
  return kind === 'markdown-bundle' ? 'markdown' : kind;
}

/** Estensioni ammesse (minuscole, con il punto) per ogni tipo di ingresso. */
export const INPUT_EXTENSIONS: Record<InputKind, readonly string[]> = {
  markdown: ['.md', '.markdown'],
  'markdown-bundle': ['.zip'],
  docx: ['.docx'],
  pdf: ['.pdf'],
};

export const ACCEPTED_EXTENSIONS: readonly string[] = Object.values(INPUT_EXTENSIONS).flat();

import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_EXTENSIONS,
  API_ERROR_CODES,
  CONVERSION_ERROR_CODES,
  DEFAULT_CONVERSION_OPTIONS,
  documentFormatOf,
  isFinalStatus,
} from '../src/index.js';

describe('shared', () => {
  it('un pacchetto Markdown resta Markdown ai fini della conversione', () => {
    expect(documentFormatOf('markdown-bundle')).toBe('markdown');
    expect(documentFormatOf('pdf')).toBe('pdf');
  });

  it('elenca tutte le estensioni accettate', () => {
    expect([...ACCEPTED_EXTENSIONS].sort()).toEqual(['.docx', '.markdown', '.md', '.pdf', '.zip']);
  });

  it('distingue gli stati finali', () => {
    expect(isFinalStatus('completed')).toBe(true);
    expect(isFinalStatus('cancelled')).toBe(true);
    expect(isFinalStatus('converting')).toBe(false);
  });

  it('ha codici di errore unici', () => {
    const all = [...API_ERROR_CODES, ...CONVERSION_ERROR_CODES];
    expect(new Set(all).size).toBe(all.length);
  });

  it('ha opzioni predefinite prudenti (OCR disattivato)', () => {
    expect(DEFAULT_CONVERSION_OPTIONS.ocr.enabled).toBe(false);
    expect(DEFAULT_CONVERSION_OPTIONS.imageMode).toBe('separate');
  });
});

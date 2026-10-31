import { describe, expect, it } from 'vitest';
import {
  contentDisposition,
  sanitizeFileName,
  uniqueFileName,
} from '../../src/files/sanitize-filename.js';

describe('sanitizeFileName', () => {
  it('mantiene i nomi normali, accenti inclusi', () => {
    expect(sanitizeFileName('Relazione finale è pronta.docx')).toBe(
      'Relazione finale è pronta.docx',
    );
  });

  it('elimina i percorsi, anche quelli con traversal', () => {
    expect(sanitizeFileName('../../etc/passwd.md')).toBe('passwd.md');
    expect(sanitizeFileName('C:\\fakepath\\documento.pdf')).toBe('documento.pdf');
  });

  it('sostituisce i caratteri vietati e di controllo', () => {
    expect(sanitizeFileName('a<b>c:d"e|f?g*h\u0000.md')).toBe('a_b_c_d_e_f_g_h_.md');
  });

  it('protegge i nomi riservati di Windows', () => {
    expect(sanitizeFileName('CON.md')).toBe('_CON.md');
    expect(sanitizeFileName('lpt1.pdf')).toBe('_lpt1.pdf');
  });

  it('usa un nome di ripiego quando non resta nulla', () => {
    expect(sanitizeFileName('...')).toBe('documento');
    expect(sanitizeFileName('  .pdf')).toBe('documento.pdf');
  });

  it("limita la lunghezza conservando l'estensione", () => {
    const result = sanitizeFileName(`${'a'.repeat(500)}.docx`);
    expect(result.length).toBeLessThanOrEqual(120);
    expect(result.endsWith('.docx')).toBe(true);
  });
});

describe('uniqueFileName', () => {
  it('aggiunge un contatore in caso di collisione (senza distinguere maiuscole)', () => {
    const used = new Set<string>();
    expect(uniqueFileName('a.md', used)).toBe('a.md');
    expect(uniqueFileName('A.md', used)).toBe('A (2).md');
    expect(uniqueFileName('a.md', used)).toBe('a (3).md');
  });
});

describe('contentDisposition', () => {
  it('produce un header con fallback ASCII e nome UTF-8', () => {
    const header = contentDisposition('perché "x".md');
    expect(header).toContain('filename="perche _x_.md"');
    expect(header).toContain("filename*=UTF-8''perch%C3%A9%20%22x%22.md");
  });
});

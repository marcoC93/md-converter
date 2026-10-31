import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPathInside, isSafeRelativePath, resolveInside } from '../../src/files/safe-path.js';

describe('isSafeRelativePath', () => {
  it.each(['documento.md', 'images/a.png', 'a/b/c.txt', 'cartella/'])('accetta %s', (entry) => {
    expect(isSafeRelativePath(entry)).toBe(true);
  });

  it.each([
    '../evil',
    'a/../../evil',
    '/etc/passwd',
    'C:/Windows/x',
    'c:evil',
    '..\\evil',
    'a\\..\\..\\b',
    '',
    'a//b',
    './a',
    'a\u0000b',
  ])('rifiuta %j', (entry) => {
    expect(isSafeRelativePath(entry)).toBe(false);
  });
});

describe('resolveInside', () => {
  const base = path.resolve('/tmp/base');

  it('risolve un percorso interno', () => {
    expect(resolveInside(base, 'images/a.png')).toBe(path.join(base, 'images', 'a.png'));
  });

  it('impedisce di uscire dalla base', () => {
    expect(() => resolveInside(base, '../outside.txt')).toThrow();
    expect(() => resolveInside(base, '/abs')).toThrow();
  });
});

describe('isPathInside', () => {
  it('distingue directory con prefisso simile', () => {
    const base = path.resolve('/tmp/job');
    expect(isPathInside(base, path.join(base, 'x'))).toBe(true);
    expect(isPathInside(base, path.resolve('/tmp/job-other/x'))).toBe(false);
  });
});

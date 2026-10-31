import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TempStore } from '../../src/files/temp-store.js';
import { createTempDir, removeDir } from '../helpers.js';

describe('TempStore', () => {
  let root: string;
  let store: TempStore;
  beforeEach(async () => {
    root = await createTempDir();
    store = new TempStore(path.join(root, 'managed'));
    await store.init();
  });
  afterEach(async () => removeDir(root));

  it('crea e rimuove le directory di un job', async () => {
    const id = randomUUID();
    const paths = await store.createJobDirs(id);
    await writeFile(path.join(paths.input, 'file.pdf'), 'x');
    expect(existsSync(paths.input) && existsSync(paths.work) && existsSync(paths.output)).toBe(
      true,
    );
    await store.removeJobDir(id);
    expect(existsSync(paths.root)).toBe(false);
  });

  it('rifiuta ID non validi', () => {
    expect(() => store.jobPaths('../../etc')).toThrow();
    expect(() => store.jobPaths('not-a-uuid')).toThrow();
  });

  it('non cancella mai fuori dalla directory gestita', async () => {
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    await expect(store.removeInside(outside)).rejects.toThrow();
    await expect(store.removeInside(store.rootDir)).rejects.toThrow();
    await expect(store.removeInside(path.join(store.rootDir, '..', 'outside'))).rejects.toThrow();
    expect(existsSync(outside)).toBe(true);
  });

  it('non cancella directory interne che non appartengono a un job', async () => {
    const foreign = path.join(store.rootDir, 'other-data');
    await mkdir(foreign);
    await expect(store.removeInside(foreign)).rejects.toThrow();
    expect(existsSync(foreign)).toBe(true);
  });

  it('rimuove solo le directory orfane più vecchie del TTL', async () => {
    const oldId = randomUUID();
    const recentId = randomUUID();
    const activeId = randomUUID();
    for (const id of [oldId, recentId, activeId]) await store.createJobDirs(id);
    const past = new Date(Date.now() - 2 * 3600_000);
    await utimes(store.jobPaths(oldId).root, past, past);
    await utimes(store.jobPaths(activeId).root, past, past);

    const removed = await store.removeStaleJobDirs(3600_000, new Set([activeId]));
    expect(removed).toBe(1);
    expect(existsSync(store.jobPaths(oldId).root)).toBe(false);
    expect(existsSync(store.jobPaths(recentId).root)).toBe(true);
    expect(existsSync(store.jobPaths(activeId).root)).toBe(true);
  });
});

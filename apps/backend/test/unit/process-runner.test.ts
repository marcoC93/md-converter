import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildChildEnv } from '../../src/process/child-env.js';
import { ProcessError, runProcess } from '../../src/process/process-runner.js';

// Usiamo Node stesso come "programma esterno": è disponibile su ogni sistema di test.
const node = process.execPath;
const cwd = os.tmpdir();

describe('runProcess', () => {
  it('restituisce stdout e stderr di un processo riuscito', async () => {
    const result = await runProcess({
      command: node,
      args: ['-e', 'process.stdout.write("ciao"); process.stderr.write("avviso")'],
      cwd,
      timeoutMs: 10_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('ciao');
    expect(result.stderr).toBe('avviso');
  });

  it('segnala un exit code diverso da zero', async () => {
    const promise = runProcess({
      command: node,
      args: ['-e', 'process.exit(3)'],
      cwd,
      timeoutMs: 10_000,
    });
    await expect(promise).rejects.toBeInstanceOf(ProcessError);
    await expect(promise).rejects.toMatchObject({ kind: 'exit-code', result: { exitCode: 3 } });
  });

  it('accetta exit code aggiuntivi se indicati', async () => {
    const result = await runProcess({
      command: node,
      args: ['-e', 'process.exit(1)'],
      cwd,
      timeoutMs: 10_000,
      successExitCodes: [0, 1],
    });
    expect(result.exitCode).toBe(1);
  });

  // Il processo figlio non termina mai da solo: se il timeout non lo uccidesse, il test scadrebbe.
  it('termina il processo allo scadere del timeout', async () => {
    const promise = runProcess({
      command: node,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd,
      timeoutMs: 300,
    });
    await expect(promise).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('termina il processo quando viene annullato', async () => {
    const controller = new AbortController();
    const promise = runProcess({
      command: node,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd,
      timeoutMs: 30_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 200);
    await expect(promise).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('non avvia nulla se il segnale è già annullato', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runProcess({
        command: node,
        args: ['-e', ''],
        cwd,
        timeoutMs: 1000,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({
      kind: 'cancelled',
    });
  });

  it('limita la quantità di output conservata', async () => {
    const result = await runProcess({
      command: node,
      args: ['-e', 'process.stdout.write("a".repeat(200000) + "FINE")'],
      cwd,
      timeoutMs: 10_000,
      maxCapturedBytes: 1000,
    });
    expect(result.stdout.length).toBeLessThanOrEqual(1000);
    expect(result.stdout.endsWith('FINE')).toBe(true);
  });

  it('segnala un eseguibile inesistente', async () => {
    await expect(
      runProcess({ command: path.join(cwd, 'non-esiste-12345'), args: [], cwd, timeoutMs: 1000 }),
    ).rejects.toMatchObject({
      kind: 'spawn-failed',
    });
  });

  it('non interpreta gli argomenti con una shell (niente command injection)', async () => {
    const marker = path.join(cwd, `injection-${Date.now()}.txt`);
    const malicious = `x"; echo pwned > "${marker}"; echo "`;
    const result = await runProcess({
      command: node,
      args: ['-e', 'process.stdout.write(process.argv[1])', malicious],
      cwd,
      timeoutMs: 10_000,
    });
    expect(result.stdout).toBe(malicious);
    expect(existsSync(marker)).toBe(false);
  });
});

describe('buildChildEnv', () => {
  it('passa solo le variabili consentite e reindirizza le directory temporanee', () => {
    const env = buildChildEnv('/work/job', {
      PATH: '/usr/bin',
      SECRET_TOKEN: 'abc',
      PANDOC_PATH: '/x',
    });
    expect(env.PATH).toBe('/usr/bin');
    expect(env.SECRET_TOKEN).toBeUndefined();
    expect(env.PANDOC_PATH).toBeUndefined();
    expect(env.TMPDIR).toBe(path.join('/work/job', 'tmp'));
  });

  it('mette in testa al PATH le cartelle degli strumenti richiamati da altri strumenti', () => {
    const env = buildChildEnv('/work/job', { Path: '/usr/bin' }, ['/opt/tesseract']);
    expect(env.PATH).toBe(['/opt/tesseract', '/usr/bin'].join(path.delimiter));
    // Una sola variabile PATH, anche quando Windows la chiama "Path".
    expect(env.Path).toBeUndefined();
  });
});

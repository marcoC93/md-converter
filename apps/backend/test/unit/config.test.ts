import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('usa valori predefiniti prudenti e ascolta solo su loopback', () => {
    const config = loadConfig({});
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(8080);
    expect(config.maxFileSizeBytes).toBe(50 * 1024 * 1024);
    expect(config.allowedOcrLanguages).toEqual(['ita', 'eng']);
    expect(path.isAbsolute(config.tempDir)).toBe(true);
  });

  it('rifiuta 0.0.0.0 senza consenso esplicito', () => {
    expect(() => loadConfig({ HOST: '0.0.0.0' })).toThrow(ConfigError);
    expect(loadConfig({ HOST: '0.0.0.0', ALLOW_NON_LOOPBACK: 'true' }).host).toBe('0.0.0.0');
  });

  it('valida numeri e lingue OCR', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(ConfigError);
    expect(() => loadConfig({ MAX_FILE_SIZE_MB: '0' })).toThrow(ConfigError);
    expect(() => loadConfig({ OCR_LANGUAGES: 'ita,eng;rm -rf' })).toThrow(ConfigError);
    expect(loadConfig({ OCR_LANGUAGES: 'ita, deu ,chi_sim' }).allowedOcrLanguages).toEqual([
      'ita',
      'deu',
      'chi_sim',
    ]);
  });

  it('richiede un limite complessivo non inferiore a quello per file', () => {
    expect(() => loadConfig({ MAX_FILE_SIZE_MB: '100', MAX_TOTAL_SIZE_MB: '50' })).toThrow(
      ConfigError,
    );
  });

  it('legge i percorsi degli eseguibili', () => {
    expect(
      loadConfig({ PANDOC_PATH: '/opt/pandoc/bin/pandoc', LIBREOFFICE_PATH: '  ' }).toolPaths,
    ).toEqual({
      pandoc: '/opt/pandoc/bin/pandoc',
      libreoffice: undefined,
      tesseract: undefined,
      ocrmypdf: undefined,
    });
  });
});

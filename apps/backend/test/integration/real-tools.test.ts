import type { ConversionOptions, JobSnapshot } from '@md-converter/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type Application } from '../../src/app.js';
import { createTempDir, multipartPayload, readFixture, removeDir, testConfig } from '../helpers.js';

/**
 * Test con gli strumenti veri installati sul computer (o nel container Docker).
 * Ogni test viene saltato, con un messaggio esplicito, se lo strumento necessario non è disponibile.
 */
const HOST = { host: '127.0.0.1:8080' };
const options = (overrides: Partial<ConversionOptions>): ConversionOptions => ({
  outputFormat: 'docx',
  mode: 'simple',
  imageMode: 'separate',
  ocr: { enabled: false, languages: ['eng'], force: false },
  ...overrides,
});

let tempDir: string;
let application: Application;
const available = { pandoc: false, libreoffice: false, ocr: false };

beforeAll(async () => {
  tempDir = await createTempDir();
  // I percorsi degli strumenti possono arrivare dall'ambiente (es. PANDOC_PATH=... pnpm test).
  const toolPaths = Object.fromEntries(
    ['PANDOC_PATH', 'LIBREOFFICE_PATH', 'TESSERACT_PATH', 'OCRMYPDF_PATH'].flatMap((name) =>
      process.env[name] ? [[name, process.env[name]!]] : [],
    ),
  );
  application = await buildApp(
    testConfig(tempDir, {
      CONVERSION_TIMEOUT_SECONDS: '180',
      OCR_LANGUAGES: 'eng,ita',
      ...toolPaths,
    }),
  );
  const report = await application.registry.refresh();
  available.pandoc = report.tools.find((tool) => tool.id === 'pandoc')?.available ?? false;
  available.libreoffice =
    report.tools.find((tool) => tool.id === 'libreoffice')?.available ?? false;
  available.ocr = report.capabilities.find((capability) => capability.from === 'pdf')?.ocr ?? false;
  console.info(
    `[real-tools] pandoc=${available.pandoc} libreoffice=${available.libreoffice} ocr=${available.ocr}`,
  );
}, 120_000);

afterAll(async () => {
  await application.app.close();
  await removeDir(tempDir);
});

async function convert(fixture: string, conversion: ConversionOptions) {
  const job = (
    await application.app.inject({ method: 'POST', url: '/api/jobs', headers: HOST })
  ).json<JobSnapshot>();
  const { payload, headers } = multipartPayload(fixture, await readFixture(fixture));
  const upload = await application.app.inject({
    method: 'POST',
    url: `/api/jobs/${job.id}/files`,
    payload,
    headers: { ...headers, ...HOST },
  });
  expect(upload.statusCode).toBe(201);
  await application.app.inject({
    method: 'POST',
    url: `/api/jobs/${job.id}/start`,
    headers: HOST,
    payload: conversion,
  });
  await application.jobs.waitForIdle();
  const file = application.jobs.getJob(job.id).files[0]!;
  expect(file.error).toBeNull();
  expect(file.status).toBe('completed');
  const download = await application.app.inject({
    method: 'GET',
    url: `/api/jobs/${job.id}/files/${file.id}/download`,
    headers: HOST,
  });
  return { file, payload: download.rawPayload };
}

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** Salta il test a runtime (la disponibilità è nota solo dopo beforeAll) indicando il motivo. */
function realTest(name: string, requirement: () => boolean, body: () => Promise<void>) {
  it(
    name,
    async (context) => {
      if (!requirement()) context.skip(`strumento non disponibile per: ${name}`);
      await body();
    },
    200_000,
  );
}

describe('strumenti reali', () => {
  it('PDF → Markdown (sempre disponibile)', async () => {
    const { payload } = await convert(
      'text.pdf',
      options({ outputFormat: 'markdown', imageMode: 'embedded' }),
    );
    expect(payload.toString()).toContain('# Rapporto di esempio');
  });

  realTest(
    'Markdown → DOCX',
    () => available.pandoc,
    async () => {
      const { payload } = await convert('simple.md', options({ outputFormat: 'docx' }));
      expect(payload.subarray(0, 4)).toEqual(ZIP);
    },
  );

  realTest(
    'pacchetto Markdown con immagini → DOCX',
    () => available.pandoc,
    async () => {
      const { payload, file } = await convert(
        'with-images.zip',
        options({ outputFormat: 'docx', mode: 'high-fidelity' }),
      );
      expect(payload.subarray(0, 4)).toEqual(ZIP);
      expect(payload.includes(Buffer.from('word/media/'))).toBe(true);
      expect(file.result?.warnings).toContain('REMOTE_IMAGES_BLOCKED');
    },
  );

  realTest(
    'DOCX → Markdown con cartella images/',
    () => available.pandoc,
    async () => {
      const { payload, file } = await convert(
        'simple.docx',
        options({ outputFormat: 'markdown', imageMode: 'separate' }),
      );
      expect(file.result?.isArchive).toBe(true);
      expect(payload.includes(Buffer.from('images/image-001.png'))).toBe(true);
    },
  );

  realTest(
    'DOCX → Markdown con immagini Base64',
    () => available.pandoc,
    async () => {
      const { payload } = await convert(
        'simple.docx',
        options({ outputFormat: 'markdown', imageMode: 'embedded' }),
      );
      const markdown = payload.toString();
      expect(markdown).toContain('# Relazione di prova');
      expect(markdown).toContain('data:image/png;base64,');
    },
  );

  realTest(
    'PDF → DOCX semplice',
    () => available.pandoc,
    async () => {
      const { payload } = await convert(
        'text.pdf',
        options({ outputFormat: 'docx', mode: 'simple' }),
      );
      expect(payload.subarray(0, 4)).toEqual(ZIP);
    },
  );

  realTest(
    'DOCX → PDF',
    () => available.libreoffice,
    async () => {
      const { payload } = await convert('simple.docx', options({ outputFormat: 'pdf' }));
      expect(payload.subarray(0, 5).toString()).toBe('%PDF-');
    },
  );

  realTest(
    'Markdown → PDF',
    () => available.pandoc && available.libreoffice,
    async () => {
      const { payload } = await convert('simple.md', options({ outputFormat: 'pdf' }));
      expect(payload.subarray(0, 5).toString()).toBe('%PDF-');
    },
  );

  realTest(
    'PDF → DOCX alta fedeltà',
    () => available.libreoffice,
    async () => {
      const { payload } = await convert(
        'text.pdf',
        options({ outputFormat: 'docx', mode: 'high-fidelity' }),
      );
      expect(payload.subarray(0, 4)).toEqual(ZIP);
    },
  );

  realTest(
    'PDF scansionato → Markdown con OCR',
    () => available.ocr,
    async () => {
      const { payload } = await convert(
        'scanned.pdf',
        // "embedded": il risultato è un .md leggibile come testo (con "separate" sarebbe uno ZIP).
        options({
          outputFormat: 'markdown',
          imageMode: 'embedded',
          ocr: { enabled: true, languages: ['ita', 'eng'], force: false },
        }),
      );
      // Il font a blocchi della fixture fa leggere "SCAMSIONE": verifichiamo la parte stabile.
      expect(payload.toString().toUpperCase()).toContain('DI PROVA');
    },
  );
});

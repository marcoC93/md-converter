// Smoke test contro un'istanza in esecuzione (Docker o nativa), con gli strumenti reali.
// Uso:
//   docker compose up -d --build
//   pnpm smoke                      (BASE_URL predefinito: http://127.0.0.1:8080)
//   pnpm smoke -- --allow-missing   (salta le conversioni i cui strumenti non sono installati)
// Non richiede dipendenze: usa fetch, FormData e Blob di Node.js >= 22.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
const allowMissing = process.argv.includes('--allow-missing');
const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'files');
const TIMEOUT_MS = 240_000;

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const PDF = [0x25, 0x50, 0x44, 0x46];
const startsWith = (buffer, bytes) => bytes.every((byte, index) => buffer[index] === byte);

const CASES = [
  {
    name: 'Markdown → DOCX',
    fixture: 'simple.md',
    options: { outputFormat: 'docx' },
    check: (b) => startsWith(b, ZIP),
  },
  {
    name: 'Markdown (zip con immagini) → DOCX',
    fixture: 'with-images.zip',
    options: { outputFormat: 'docx', mode: 'high-fidelity' },
    check: (b) => startsWith(b, ZIP) && b.includes('word/media/'),
  },
  {
    name: 'Markdown → PDF',
    fixture: 'simple.md',
    options: { outputFormat: 'pdf' },
    check: (b) => startsWith(b, PDF),
  },
  {
    name: 'DOCX → Markdown (images/)',
    fixture: 'simple.docx',
    options: { outputFormat: 'markdown', imageMode: 'separate' },
    check: (b) => startsWith(b, ZIP) && b.includes('images/image-001'),
  },
  {
    name: 'DOCX → Markdown (Base64)',
    fixture: 'simple.docx',
    options: { outputFormat: 'markdown', imageMode: 'embedded' },
    check: (b) => b.toString().includes('data:image/png;base64,'),
  },
  {
    name: 'DOCX → PDF',
    fixture: 'simple.docx',
    options: { outputFormat: 'pdf' },
    check: (b) => startsWith(b, PDF),
  },
  {
    name: 'PDF → Markdown',
    fixture: 'text.pdf',
    options: { outputFormat: 'markdown', imageMode: 'embedded' },
    check: (b) => b.toString().includes('# Rapporto di esempio'),
  },
  {
    name: 'PDF → DOCX (semplice)',
    fixture: 'text.pdf',
    options: { outputFormat: 'docx', mode: 'simple' },
    check: (b) => startsWith(b, ZIP),
  },
  {
    name: 'PDF → DOCX (alta fedeltà)',
    fixture: 'text.pdf',
    options: { outputFormat: 'docx', mode: 'high-fidelity' },
    check: (b) => startsWith(b, ZIP),
  },
  {
    name: 'PDF scansionato → Markdown con OCR',
    fixture: 'scanned.pdf',
    options: { outputFormat: 'markdown', ocr: { enabled: true, languages: ['eng'], force: false } },
    check: () => true,
    ocr: true,
  },
];

function fullOptions(options) {
  return {
    mode: 'simple',
    imageMode: 'separate',
    ocr: { enabled: false, languages: ['eng'], force: false },
    ...options,
  };
}

async function api(method, url, body) {
  const response = await fetch(`${BASE_URL}${url}`, {
    method,
    body,
    headers: body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {},
  });
  if (!response.ok)
    throw new Error(`${method} ${url} → ${response.status} ${await response.text()}`);
  return response;
}

async function runCase(testCase) {
  const job = await (await api('POST', '/api/jobs')).json();
  try {
    const form = new FormData();
    form.append(
      'file',
      new Blob([await readFile(path.join(fixtures, testCase.fixture))]),
      testCase.fixture,
    );
    const file = await (await api('POST', `/api/jobs/${job.id}/files`, form)).json();
    await api('POST', `/api/jobs/${job.id}/start`, JSON.stringify(fullOptions(testCase.options)));

    const started = Date.now();
    let current;
    do {
      await new Promise((resolve) => setTimeout(resolve, 500));
      current = (await (await api('GET', `/api/jobs/${job.id}`)).json()).files[0];
      if (Date.now() - started > TIMEOUT_MS) throw new Error('timeout del test');
    } while (!['completed', 'failed', 'cancelled'].includes(current.status));

    if (current.status !== 'completed')
      throw new Error(
        `${current.error?.code}: ${current.error?.details ?? current.error?.message}`,
      );
    const result = Buffer.from(
      await (await api('GET', `/api/jobs/${job.id}/files/${file.id}/download`)).arrayBuffer(),
    );
    if (!testCase.check(result)) throw new Error('contenuto del risultato inatteso');
    if (testCase.ocr) {
      const text = result.toString().toUpperCase();
      console.log(
        `      testo OCR riconosciuto: ${/SCANSIONE|PROVA/.test(text) ? 'sì' : 'no (font di prova molto stilizzato)'}`,
      );
    }
    return { ms: Date.now() - started, warnings: current.result?.warnings ?? [] };
  } finally {
    await fetch(`${BASE_URL}/api/jobs/${job.id}`, { method: 'DELETE' });
  }
}

function capabilityFor(report, testCase) {
  const from = testCase.fixture.endsWith('.pdf')
    ? 'pdf'
    : testCase.fixture.endsWith('.docx')
      ? 'docx'
      : 'markdown';
  const capability = report.capabilities.find(
    (entry) => entry.from === from && entry.to === testCase.options.outputFormat,
  );
  const modeOk =
    (testCase.options.mode ?? 'simple') === 'simple'
      ? capability?.simple
      : capability?.highFidelity;
  return Boolean(modeOk && (!testCase.ocr || capability?.ocr));
}

async function main() {
  console.log(`Smoke test su ${BASE_URL}\n`);
  await api('GET', '/api/health');
  const report = await (await api('GET', '/api/diagnostics?refresh=true')).json();
  for (const tool of report.tools)
    console.log(`  ${tool.available ? '✓' : '✕'} ${tool.id} ${tool.version ?? ''}`);
  console.log(`  lingue OCR: ${report.ocrLanguages.join(', ') || 'nessuna'}\n`);

  const hostCheck = await fetch(`${BASE_URL}/api/health`, { headers: { 'X-Test': '1' } });
  if (!hostCheck.headers.get('content-security-policy'))
    throw new Error('header di sicurezza mancanti');

  let failures = 0;
  for (const testCase of CASES) {
    if (!capabilityFor(report, testCase)) {
      if (allowMissing) {
        console.log(`  ↓ ${testCase.name}: saltato (strumento non disponibile)`);
        continue;
      }
      console.log(`  ✕ ${testCase.name}: strumento non disponibile`);
      failures++;
      continue;
    }
    try {
      const { ms, warnings } = await runCase(testCase);
      console.log(
        `  ✓ ${testCase.name} (${ms} ms)${warnings.length ? ` avvisi: ${warnings.join(', ')}` : ''}`,
      );
    } catch (error) {
      failures++;
      console.log(`  ✕ ${testCase.name}: ${error.message}`);
    }
  }
  console.log(
    failures === 0 ? '\nSmoke test superato.' : `\nSmoke test fallito: ${failures} errori.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`Smoke test interrotto: ${error.message}`);
  process.exit(1);
});

// Misura la durata delle conversioni contro un'istanza in esecuzione.
// Uso:  pnpm start   (in un altro terminale)   poi   pnpm bench
// Opzioni: --runs=5 (ripetizioni per caso), BASE_URL=http://127.0.0.1:8080
// Per ogni caso mostra la durata minima, mediana e massima dall'avvio al completamento,
// e la sequenza degli stati osservati: utile per scoprire conversioni che non terminano.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
const runs = Number(process.argv.find((arg) => arg.startsWith('--runs='))?.split('=')[1] ?? 3);
const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'files');
const STUCK_AFTER_MS = 60_000;
const POLL_MS = 25;

const CASES = [
  ['text.pdf', 'markdown', 'simple', 'separate'],
  ['text.pdf', 'markdown', 'high-fidelity', 'embedded'],
  ['text.pdf', 'docx', 'simple', 'separate'],
  ['text.pdf', 'docx', 'high-fidelity', 'separate'],
  ['scanned.pdf', 'markdown', 'simple', 'separate'],
  ['simple.md', 'docx', 'simple', 'separate'],
  ['simple.md', 'pdf', 'simple', 'separate'],
  ['with-images.zip', 'docx', 'high-fidelity', 'separate'],
  ['simple.docx', 'markdown', 'simple', 'separate'],
  ['simple.docx', 'markdown', 'simple', 'embedded'],
  ['simple.docx', 'pdf', 'simple', 'separate'],
];

async function json(method, url, body) {
  const init = { method };
  if (body instanceof FormData) init.body = body;
  else if (body)
    Object.assign(init, {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
  const response = await fetch(`${BASE_URL}${url}`, init);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function runOnce([fixture, outputFormat, mode, imageMode]) {
  const job = await json('POST', '/api/jobs');
  try {
    const form = new FormData();
    form.append('file', new Blob([await readFile(path.join(fixtures, fixture))]), fixture);
    const uploadStart = Date.now();
    const uploaded = await json('POST', `/api/jobs/${job.id}/files`, form);
    if (uploaded.error) return { error: uploaded.error.code, states: [] };
    const uploadMs = Date.now() - uploadStart;

    const start = Date.now();
    await json('POST', `/api/jobs/${job.id}/start`, {
      outputFormat,
      mode,
      imageMode,
      ocr: { enabled: false, languages: ['ita'], force: false },
    });
    const states = [];
    for (;;) {
      const file = (await json('GET', `/api/jobs/${job.id}`)).files[0];
      const state = file.stage ? `${file.status}:${file.stage}` : file.status;
      if (states.at(-1) !== state) states.push(state);
      if (['completed', 'failed', 'cancelled'].includes(file.status)) {
        return { uploadMs, ms: Date.now() - start, outcome: file.error?.code ?? 'ok', states };
      }
      if (Date.now() - start > STUCK_AFTER_MS)
        return { uploadMs, ms: Date.now() - start, outcome: 'BLOCCATO', states };
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  } finally {
    await fetch(`${BASE_URL}/api/jobs/${job.id}`, { method: 'DELETE' });
  }
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

console.log(`Benchmark su ${BASE_URL}, ${runs} ripetizioni per caso\n`);
const report = await json('GET', '/api/diagnostics');
console.log(
  `Strumenti: ${report.tools.map((tool) => `${tool.id}=${tool.available ? tool.version : 'no'}`).join(', ')}\n`,
);
console.log(
  'caso'.padEnd(52) +
    'esito'.padEnd(24) +
    'min'.padStart(8) +
    'mediana'.padStart(9) +
    'max'.padStart(8) +
    '  upload  stati',
);

let stuck = 0;
for (const testCase of CASES) {
  const results = [];
  for (let index = 0; index < runs; index++) results.push(await runOnce(testCase));
  const times = results.map((result) => result.ms ?? 0);
  const outcomes = [...new Set(results.map((result) => result.outcome ?? result.error))].join(',');
  if (outcomes.includes('BLOCCATO')) stuck++;
  const [fixture, outputFormat, mode, imageMode] = testCase;
  const label = `${fixture} → ${outputFormat} (${mode}${outputFormat === 'markdown' ? `, ${imageMode}` : ''})`;
  console.log(
    label.padEnd(52) +
      outcomes.padEnd(24) +
      `${Math.min(...times)}ms`.padStart(8) +
      `${median(times)}ms`.padStart(9) +
      `${Math.max(...times)}ms`.padStart(8) +
      `${String(median(results.map((result) => result.uploadMs ?? 0))).padStart(6)}ms  ${results[0].states.join(' > ')}`,
  );
}
console.log(stuck === 0 ? '\nNessuna conversione bloccata.' : `\n${stuck} casi bloccati.`);
process.exit(stuck === 0 ? 0 : 1);

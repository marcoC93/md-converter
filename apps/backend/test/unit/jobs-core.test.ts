import { describe, expect, it } from 'vitest';
import { requiredTools, selectPipeline } from '../../src/conversion/pipeline-selector.js';
import { ConversionQueue } from '../../src/jobs/conversion-queue.js';
import { assertTransition, canTransition, isCancellable } from '../../src/jobs/file-state.js';

describe('selectPipeline', () => {
  it.each([
    ['markdown', 'docx', 'simple', 'markdown-to-docx', ['pandoc']],
    ['markdown-bundle', 'docx', 'simple', 'markdown-to-docx', ['pandoc']],
    ['markdown', 'pdf', 'simple', 'markdown-to-pdf', ['pandoc', 'libreoffice']],
    ['docx', 'markdown', 'high-fidelity', 'docx-to-markdown', ['pandoc']],
    ['docx', 'pdf', 'simple', 'docx-to-pdf', ['libreoffice']],
    ['pdf', 'markdown', 'simple', 'pdf-to-markdown', []],
    ['pdf', 'docx', 'simple', 'pdf-to-docx-simple', ['pandoc']],
    ['pdf', 'docx', 'high-fidelity', 'pdf-to-docx-high-fidelity', ['libreoffice']],
  ] as const)('%s → %s (%s) usa %s', (input, output, mode, id, tools) => {
    const pipeline = selectPipeline(input, { outputFormat: output, mode });
    expect(pipeline?.id).toBe(id);
    expect(pipeline?.tools).toEqual(tools);
  });

  it('copre tutte e sei le conversioni richieste', () => {
    const pairs = [
      ['markdown', 'docx'],
      ['markdown', 'pdf'],
      ['docx', 'markdown'],
      ['docx', 'pdf'],
      ['pdf', 'markdown'],
      ['pdf', 'docx'],
    ] as const;
    for (const [input, output] of pairs) {
      for (const mode of ['simple', 'high-fidelity'] as const) {
        expect(selectPipeline(input, { outputFormat: output, mode })).not.toBeNull();
      }
    }
  });

  it('rifiuta le conversioni verso lo stesso formato', () => {
    expect(selectPipeline('pdf', { outputFormat: 'pdf', mode: 'simple' })).toBeNull();
    expect(
      selectPipeline('markdown-bundle', { outputFormat: 'markdown', mode: 'simple' }),
    ).toBeNull();
  });

  it('aggiunge gli strumenti OCR solo per i PDF con OCR attivo', () => {
    const pdf = selectPipeline('pdf', { outputFormat: 'markdown', mode: 'simple' })!;
    expect(requiredTools(pdf, true)).toEqual(['ocrmypdf', 'tesseract']);
    expect(requiredTools(pdf, false)).toEqual([]);
    const docx = selectPipeline('docx', { outputFormat: 'pdf', mode: 'simple' })!;
    expect(requiredTools(docx, true)).toEqual(['libreoffice']);
  });
});

describe('stati dei file', () => {
  it('ammette il percorso normale', () => {
    expect(() => {
      assertTransition('validating', 'ready');
      assertTransition('ready', 'queued');
      assertTransition('queued', 'converting');
      assertTransition('converting', 'completed');
    }).not.toThrow();
  });

  it('vieta di uscire da uno stato finale', () => {
    expect(canTransition('completed', 'converting')).toBe(false);
    expect(canTransition('failed', 'queued')).toBe(false);
    expect(() => assertTransition('cancelled', 'ready')).toThrow();
  });

  it('permette di annullare solo i file non conclusi', () => {
    expect(isCancellable('queued')).toBe(true);
    expect(isCancellable('converting')).toBe(true);
    expect(isCancellable('completed')).toBe(false);
  });
});

describe('ConversionQueue', () => {
  it('non supera la concorrenza configurata', async () => {
    const queue = new ConversionQueue(2);
    let running = 0;
    let maxRunning = 0;
    const task = () => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running--;
    };
    for (let index = 0; index < 6; index++) queue.enqueue(task());
    await queue.onIdle();
    expect(maxRunning).toBe(2);
  });

  it('continua anche se un compito fallisce', async () => {
    const queue = new ConversionQueue(1);
    const done: number[] = [];
    queue.enqueue(async () => {
      throw new Error('boom');
    });
    queue.enqueue(async () => {
      done.push(1);
    });
    await queue.onIdle();
    expect(done).toEqual([1]);
  });

  it('rifiuta una concorrenza non valida', () => {
    expect(() => new ConversionQueue(0)).toThrow();
  });
});

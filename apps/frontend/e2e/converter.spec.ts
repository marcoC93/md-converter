import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const fixtures = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'tests',
  'fixtures',
  'files',
);
const fixture = (name: string) => path.join(fixtures, name);

async function openApp(page: Page) {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Convertitore documenti' }),
  ).toBeVisible();
}

async function addFiles(page: Page, ...names: string[]) {
  await page.getByTestId('file-input').setInputFiles(names.map(fixture));
}

test.beforeEach(async ({ page }) => {
  // Ogni test parte da una sessione pulita.
  await page.addInitScript(() => window.sessionStorage.clear());
});

test('carica un PDF, sceglie Markdown, converte e scarica il risultato', async ({ page }) => {
  await openApp(page);
  await addFiles(page, 'text.pdf');
  const item = page.getByTestId('queue-item').first();
  await expect(item).toHaveAttribute('data-status', 'ready');
  await expect(item).toContainText('3 pagine');
  await expect(page.getByTestId('pdf-notice')).toBeVisible();

  await page.getByTestId('format-markdown').check();
  await page.getByTestId('start').click();
  await expect(item).toHaveAttribute('data-status', 'completed', { timeout: 30_000 });
  await expect(item).toContainText('Completato');
  await expect(page.getByTestId('live-polite')).toContainText('Conversione terminata');

  const downloadPromise = page.waitForEvent('download');
  await item.getByTestId('download-item').click();
  const download = await downloadPromise;
  // Il PDF contiene un'immagine: con la modalità predefinita "cartella separata" il risultato è uno ZIP.
  expect(download.suggestedFilename()).toBe('text.zip');
  const content = await readFile((await download.path())!);
  expect(content.subarray(0, 2).toString()).toBe('PK');
});

test('immagini incorporate: un solo file Markdown con data URI', async ({ page }) => {
  await openApp(page);
  await addFiles(page, 'text.pdf');
  await page.getByTestId('format-markdown').check();
  await page.getByText('Opzioni avanzate').click();
  await page.getByTestId('images-embedded').check();
  await page.getByTestId('start').click();
  const item = page.getByTestId('queue-item').first();
  await expect(item).toHaveAttribute('data-status', 'completed', { timeout: 30_000 });
  const downloadPromise = page.waitForEvent('download');
  await item.getByTestId('download-item').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('text.md');
  const markdown = await readFile((await download.path())!, 'utf8');
  expect(markdown).toContain('# Rapporto di esempio');
  expect(markdown).toContain('data:image/png;base64,');
});

test('caricamento multiplo e download ZIP complessivo', async ({ page }) => {
  await openApp(page);
  await addFiles(page, 'text.pdf', 'scanned.pdf');
  await expect(page.getByTestId('queue-item')).toHaveCount(2);
  await expect(page.getByTestId('ocr-suggestion')).toBeVisible();
  await page.getByTestId('format-markdown').check();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('queue-summary')).toContainText('2 completati', {
    timeout: 30_000,
  });
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('download-all').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^conversioni-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.zip$/);
});

test('mostra un errore comprensibile per un file non valido', async ({ page }) => {
  await openApp(page);
  await addFiles(page, 'fake.pdf');
  const item = page.getByTestId('queue-item').first();
  await expect(item).toHaveAttribute('data-status', 'failed');
  await expect(item.getByTestId('item-error')).toContainText(
    'Il contenuto del file non corrisponde al formato indicato',
  );
  await expect(item.getByTestId('item-error')).toContainText('Codice di riferimento');
  await expect(page.getByTestId('live-assertive')).toContainText('fake.pdf');
  await expect(page.getByTestId('start')).toBeDisabled();
});

test('drag-and-drop aggiunge i file alla coda', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['# Trascinato\n'], 'trascinato.md', { type: 'text/markdown' }));
    const zone = document.querySelector('[data-testid=dropzone]')!;
    zone.dispatchEvent(
      new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
    zone.dispatchEvent(
      new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
  });
  await expect(page.getByTestId('queue-item').first()).toContainText('trascinato.md');
  await expect(page.getByTestId('queue-item').first()).toHaveAttribute('data-status', 'ready');
});

test('rimuove un file dalla coda', async ({ page }) => {
  await openApp(page);
  await addFiles(page, 'text.pdf');
  await expect(page.getByTestId('queue-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'Rimuovi text.pdf' }).click();
  await expect(page.getByTestId('queue-item')).toHaveCount(0);
});

test('cambio tema chiaro/scuro/sistema', async ({ page }) => {
  await openApp(page);
  await page.getByText('Scuro', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const darkBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.getByText('Chiaro', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const lightBackground = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );
  expect(darkBackground).not.toBe(lightBackground);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('uso essenziale da tastiera', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Vai al contenuto principale' })).toBeFocused();

  // Il pannello diagnostico si apre da tastiera, riceve il focus e si chiude con Esc.
  await page.getByTestId('toggle-diagnostics').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Diagnostica', level: 2 })).toBeFocused();
  await expect(page.getByTestId('tool-pandoc')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('diagnostics-panel')).toHaveCount(0);

  // Scelta del formato con le frecce, come in ogni gruppo di radio button.
  await page.getByTestId('format-docx').focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('format-markdown')).toBeChecked();

  // Le opzioni avanzate si aprono con la tastiera e l'interruttore OCR risponde alla barra spaziatrice.
  await page.getByText('Opzioni avanzate').focus();
  await page.keyboard.press('Enter');
  await page.getByTestId('ocr-toggle').focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('ocr-toggle')).toBeChecked();

  // Il pulsante "Scegli i file" è raggiungibile e ha un focus visibile.
  await page.getByTestId('choose-files').focus();
  const outline = await page
    .getByTestId('choose-files')
    .evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(outline).toBe('solid');
});

test('il servizio non carica risorse esterne', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) &&
      url.protocol !== 'data:' &&
      url.protocol !== 'blob:'
    )
      external.push(request.url());
  });
  await openApp(page);
  await addFiles(page, 'text.pdf');
  await expect(page.getByTestId('queue-item').first()).toHaveAttribute('data-status', 'ready');
  expect(external).toEqual([]);
});

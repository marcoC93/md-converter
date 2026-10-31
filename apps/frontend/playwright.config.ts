import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * I test end-to-end usano il backend compilato che serve anche il frontend compilato:
 * eseguire prima `pnpm build`. Porta e directory temporanea sono dedicate ai test.
 */
const PORT = 8181;
const tempDir = path.join(os.tmpdir(), 'md-converter-e2e');

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node ../backend/dist/index.js',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      TEMP_DIR: tempDir,
      LOG_LEVEL: 'warn',
      CLEANUP_AFTER_DOWNLOAD_SECONDS: '300',
    },
  },
});

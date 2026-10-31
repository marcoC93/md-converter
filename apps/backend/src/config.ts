import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const MB = 1024 * 1024;
const LOOPBACK_HOSTS = ['127.0.0.1', '::1', 'localhost'];

const booleanFromString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .default(false);

const commaSeparatedList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

const optionalPath = z
  .string()
  .optional()
  .transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined));

const positiveInt = (defaultValue: number, max: number) =>
  z.coerce.number().int().min(1).max(max).default(defaultValue);

const envSchema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  ALLOW_NON_LOOPBACK: booleanFromString,
  ALLOWED_HOSTS: commaSeparatedList,
  TEMP_DIR: optionalPath,
  JOB_TTL_MINUTES: positiveInt(60, 24 * 60),
  CLEANUP_INTERVAL_SECONDS: positiveInt(60, 3600),
  CLEANUP_AFTER_DOWNLOAD_SECONDS: z.coerce.number().int().min(0).max(86400).default(300),
  MAX_FILE_SIZE_MB: positiveInt(50, 2048),
  MAX_TOTAL_SIZE_MB: positiveInt(200, 8192),
  MAX_FILES_PER_JOB: positiveInt(20, 500),
  MAX_ACTIVE_JOBS: positiveInt(10, 100),
  MAX_CONCURRENT_JOBS: positiveInt(Math.max(1, Math.min(2, os.availableParallelism())), 32),
  CONVERSION_TIMEOUT_SECONDS: positiveInt(300, 3600),
  MAX_OUTPUT_SIZE_MB: positiveInt(200, 8192),
  MAX_EMBEDDED_IMAGES_MB: positiveInt(10, 512),
  OCR_LANGUAGES: commaSeparatedList,
  OCR_JOBS: positiveInt(1, 32),
  PANDOC_PATH: optionalPath,
  LIBREOFFICE_PATH: optionalPath,
  TESSERACT_PATH: optionalPath,
  OCRMYPDF_PATH: optionalPath,
  FRONTEND_DIST_DIR: optionalPath,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface AppConfig {
  host: string;
  port: number;
  allowedHosts: string[];
  tempDir: string;
  jobTtlMs: number;
  cleanupIntervalMs: number;
  cleanupAfterDownloadMs: number;
  maxFileSizeBytes: number;
  maxTotalSizeBytes: number;
  maxFilesPerJob: number;
  maxActiveJobs: number;
  maxConcurrentJobs: number;
  conversionTimeoutMs: number;
  maxOutputSizeBytes: number;
  maxEmbeddedImagesBytes: number;
  allowedOcrLanguages: string[];
  ocrJobs: number;
  toolPaths: {
    pandoc?: string | undefined;
    libreoffice?: string | undefined;
    tesseract?: string | undefined;
    ocrmypdf?: string | undefined;
  };
  frontendDistDir: string;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
}

export class ConfigError extends Error {}

const OCR_LANGUAGE_PATTERN = /^[a-z]{3}(_[a-z]{3,4})?$/;

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.includes(host.toLowerCase());
}

function defaultFrontendDistDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Sia da `src/` (sviluppo) sia da `dist/` (produzione) la radice del backend è il genitore.
  return path.resolve(here, '..', '..', 'frontend', 'dist');
}

/** Legge e valida le variabili d'ambiente. Lancia `ConfigError` con un messaggio leggibile. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new ConfigError(`Configurazione non valida:\n- ${problems.join('\n- ')}`);
  }
  const values = parsed.data;

  if (!isLoopbackHost(values.HOST) && !values.ALLOW_NON_LOOPBACK) {
    throw new ConfigError(
      `HOST=${values.HOST} esporrebbe il servizio sulla rete. ` +
        'Usa 127.0.0.1 oppure imposta ALLOW_NON_LOOPBACK=true se sai cosa stai facendo (vedi README, sezione Privacy).',
    );
  }

  const ocrLanguages = values.OCR_LANGUAGES.length > 0 ? values.OCR_LANGUAGES : ['ita', 'eng'];
  const invalidLanguage = ocrLanguages.find((code) => !OCR_LANGUAGE_PATTERN.test(code));
  if (invalidLanguage) {
    throw new ConfigError(`OCR_LANGUAGES contiene un codice non valido: "${invalidLanguage}"`);
  }

  if (values.MAX_TOTAL_SIZE_MB < values.MAX_FILE_SIZE_MB) {
    throw new ConfigError('MAX_TOTAL_SIZE_MB deve essere maggiore o uguale a MAX_FILE_SIZE_MB');
  }

  return {
    host: values.HOST,
    port: values.PORT,
    allowedHosts: values.ALLOWED_HOSTS.map((host) => host.toLowerCase()),
    tempDir: path.resolve(values.TEMP_DIR ?? path.join(os.tmpdir(), 'md-converter')),
    jobTtlMs: values.JOB_TTL_MINUTES * 60_000,
    cleanupIntervalMs: values.CLEANUP_INTERVAL_SECONDS * 1000,
    cleanupAfterDownloadMs: values.CLEANUP_AFTER_DOWNLOAD_SECONDS * 1000,
    maxFileSizeBytes: values.MAX_FILE_SIZE_MB * MB,
    maxTotalSizeBytes: values.MAX_TOTAL_SIZE_MB * MB,
    maxFilesPerJob: values.MAX_FILES_PER_JOB,
    maxActiveJobs: values.MAX_ACTIVE_JOBS,
    maxConcurrentJobs: values.MAX_CONCURRENT_JOBS,
    conversionTimeoutMs: values.CONVERSION_TIMEOUT_SECONDS * 1000,
    maxOutputSizeBytes: values.MAX_OUTPUT_SIZE_MB * MB,
    maxEmbeddedImagesBytes: values.MAX_EMBEDDED_IMAGES_MB * MB,
    allowedOcrLanguages: ocrLanguages,
    ocrJobs: values.OCR_JOBS,
    toolPaths: {
      pandoc: values.PANDOC_PATH,
      libreoffice: values.LIBREOFFICE_PATH,
      tesseract: values.TESSERACT_PATH,
      ocrmypdf: values.OCRMYPDF_PATH,
    },
    frontendDistDir: path.resolve(values.FRONTEND_DIST_DIR ?? defaultFrontendDistDir()),
    logLevel: values.LOG_LEVEL,
  };
}

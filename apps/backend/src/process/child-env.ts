import path from 'node:path';

/**
 * Variabili ereditate dal processo principale. Tutto il resto (inclusa la configurazione
 * dell'app) non viene passato agli strumenti esterni.
 */
const INHERITED_VARIABLES = [
  'PATHEXT',
  'SystemRoot',
  'SYSTEMROOT',
  'windir',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'CommonProgramFiles',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'LANG',
  'LC_ALL',
  'TZ',
  'TESSDATA_PREFIX',
];

/**
 * Ambiente minimo per un processo figlio. HOME e le directory temporanee puntano alla directory
 * di lavoro del job, così cache e file intermedi degli strumenti vengono cancellati insieme al job.
 *
 * `extraPathDirs` viene messo in testa al PATH: serve agli strumenti che ne avviano altri
 * (OCRmyPDF cerca `tesseract` nel PATH) quando questi sono installati fuori dal PATH di sistema.
 */
export function buildChildEnv(
  workDir: string,
  parentEnv: NodeJS.ProcessEnv = process.env,
  extraPathDirs: readonly string[] = [],
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of INHERITED_VARIABLES) {
    const value = parentEnv[name];
    if (value !== undefined) env[name] = value;
  }
  // Su Windows la variabile si chiama spesso "Path": ne passiamo una sola, sempre come "PATH".
  const inheritedPath = parentEnv.PATH ?? parentEnv.Path ?? '';
  env.PATH = [...extraPathDirs, inheritedPath]
    .filter((part) => part.length > 0)
    .join(path.delimiter);
  const tempDir = path.join(workDir, 'tmp');
  env.TMPDIR = tempDir;
  env.TMP = tempDir;
  env.TEMP = tempDir;
  if (process.platform !== 'win32') {
    env.HOME = workDir;
    env.XDG_CACHE_HOME = path.join(workDir, 'cache');
    env.XDG_CONFIG_HOME = path.join(workDir, 'config');
    env.LANG ??= 'C.UTF-8';
  }
  env.PYTHONDONTWRITEBYTECODE = '1';
  return env;
}

import path from 'node:path';

/**
 * Variabili ereditate dal processo principale. Tutto il resto (inclusa la configurazione
 * dell'app) non viene passato agli strumenti esterni.
 */
const INHERITED_VARIABLES = [
  'PATH',
  'Path',
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
 */
export function buildChildEnv(
  workDir: string,
  parentEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of INHERITED_VARIABLES) {
    const value = parentEnv[name];
    if (value !== undefined) env[name] = value;
  }
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

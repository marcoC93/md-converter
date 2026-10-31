// Stampa nel terminale lo stato delle dipendenze, come il pannello "Diagnostica" dell'interfaccia.
// Uso: pnpm diagnose
import { ConfigError, loadConfig } from '../config.js';
import { DependencyRegistry } from '../diagnostics/dependency-registry.js';
import { TempStore } from '../files/temp-store.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const tempStore = new TempStore(config.tempDir);
  await tempStore.init();
  const report = await new DependencyRegistry(tempStore, config).refresh();

  console.log(`Piattaforma: ${report.platform}\n`);
  for (const tool of report.tools) {
    const state = tool.available ? 'OK ' : 'NO ';
    const details = tool.available
      ? `${tool.version ?? 'versione sconosciuta'} (${tool.displayPath ?? ''})`
      : `problema: ${tool.problem}`;
    console.log(`[${state}] ${tool.id.padEnd(12)} ${details}`);
    if (tool.languages)
      console.log(`       lingue OCR installate: ${tool.languages.join(', ') || 'nessuna'}`);
  }
  console.log(`\nLingue OCR utilizzabili: ${report.ocrLanguages.join(', ') || 'nessuna'}\n`);
  console.log('Conversioni disponibili:');
  for (const capability of report.capabilities) {
    const modes = [
      capability.simple ? 'semplice' : null,
      capability.highFidelity ? 'alta fedeltà' : null,
    ]
      .filter(Boolean)
      .join(', ');
    console.log(
      `  ${capability.from} → ${capability.to}: ${modes || 'non disponibile'}${capability.ocr ? ' (+ OCR)' : ''}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
});

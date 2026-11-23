// Bündelt Seite, Worker, Preload und Hauptprogramm nach spikes/electron-check/out/ (Aufruf aus web/: node spikes/electron-check/build.mts).
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

const spikeDirectory = dirname(fileURLToPath(import.meta.url));
const outDirectory = join(spikeDirectory, 'out');
const pdfjsBuild = join(spikeDirectory, '../../node_modules/pdfjs-dist/build');

await mkdir(outDirectory, { recursive: true });
await build({ input: join(spikeDirectory, 'src/page.ts'), platform: 'browser', output: { file: join(outDirectory, 'page.js'), format: 'esm' } });
await build({ input: join(spikeDirectory, 'src/probeWorker.ts'), platform: 'browser', output: { file: join(outDirectory, 'probeWorker.js'), format: 'esm' } });
await build({ input: join(spikeDirectory, 'preload.ts'), platform: 'node', external: ['electron'], output: { file: join(outDirectory, 'preload.cjs'), format: 'cjs' } });
await build({ input: join(spikeDirectory, 'main.ts'), platform: 'node', external: ['electron'], output: { file: join(outDirectory, 'main.cjs'), format: 'cjs' } });
await copyFile(join(spikeDirectory, 'page.template.html'), join(outDirectory, 'page.template.html'));
await copyFile(join(pdfjsBuild, 'pdf.worker.min.mjs'), join(outDirectory, 'pdf.worker.min.mjs'));
console.log(`Gebaut nach ${outDirectory}`);

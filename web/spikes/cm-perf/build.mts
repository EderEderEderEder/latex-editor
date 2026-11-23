// Bündelt Messseite und Hauptprogramm nach spikes/cm-perf/out/ (Aufruf aus web/: node spikes/cm-perf/build.mts).
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

const spikeDirectory = dirname(fileURLToPath(import.meta.url));
const outDirectory = join(spikeDirectory, 'out');

async function buildAll(): Promise<void> {
    await mkdir(outDirectory, { recursive: true });
    await build({
        input: join(spikeDirectory, 'src/page.ts'),
        platform: 'browser',
        output: { file: join(outDirectory, 'page.js'), format: 'iife', minify: true },
    });
    await build({
        input: join(spikeDirectory, 'main.ts'),
        platform: 'node',
        external: ['electron'],
        output: { file: join(outDirectory, 'main.cjs'), format: 'cjs' },
    });
    await copyFile(join(spikeDirectory, 'index.html'), join(outDirectory, 'index.html'));
    console.log(`Gebaut nach ${outDirectory}`);
}

await buildAll();

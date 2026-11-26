// Bündelt Spike S8 nach spikes/spell/out/ (Aufruf aus web/: SPELL_SPIKE_MODULES=<Ordner mit node_modules> node spikes/spell/build.mts).
// `nspell` ist NICHT in web/package.json: es liegt nur zum Messen in einem Wegwerf-Ordner (SPELL_SPIKE_MODULES/node_modules).
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

const spikeDirectory = dirname(fileURLToPath(import.meta.url));
const outDirectory = join(spikeDirectory, 'out');

function nspellAlias(): Record<string, string> {
    const modules = process.env['SPELL_SPIKE_MODULES'];
    if (modules === undefined) throw new Error('SPELL_SPIKE_MODULES fehlt (Ordner, in dem nspell per npm installiert ist)');
    return { nspell: join(modules, 'node_modules/nspell/lib/index.js') };
}

async function bundle(input: string, file: string, platform: 'node' | 'browser', format: 'cjs' | 'esm' | 'iife'): Promise<void> {
    await build({
        input: join(spikeDirectory, input),
        platform,
        external: ['electron'],
        resolve: { alias: nspellAlias() },
        output: { file: join(outDirectory, file), format },
    });
}

async function buildAll(): Promise<void> {
    await mkdir(outDirectory, { recursive: true });
    await bundle('src/nodeBench.ts', 'nodeBench.mjs', 'node', 'esm');
    await bundle('main.ts', 'main.cjs', 'node', 'cjs');
    await bundle('preload.ts', 'preload.cjs', 'node', 'cjs');
    await bundle('src/page.ts', 'page.js', 'browser', 'iife');
    await bundle('src/spell.worker.ts', 'spell.worker.js', 'browser', 'iife');
    await copyFile(join(spikeDirectory, 'index.html'), join(outDirectory, 'index.html'));
    console.log(`Gebaut nach ${outDirectory}`);
}

await buildAll();

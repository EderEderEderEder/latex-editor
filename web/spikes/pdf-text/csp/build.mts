// Bündelt Hauptprogramm und Messseite der W3-3a-Messung nach csp/out/ und kopiert die pdf.js-Dateien dorthin, wie sie
// später im Paket neben der index.html liegen (Aufruf aus web/: node spikes/pdf-text/csp/build.mts).
import { copyFile, cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

const cspDirectory = dirname(fileURLToPath(import.meta.url));
const outDirectory = join(cspDirectory, 'out');
const pdfjsDirectory = join(cspDirectory, '../../../node_modules/pdfjs-dist');
// Die S2-Quellen importieren `./geometry.mjs` usw. (tsc-Schreibweise), liegen aber als `.mts` vor
const SOURCE_EXTENSIONS = { '.mjs': ['.mts', '.mjs'] };
const PDFJS_FILES = ['build/pdf.worker.min.mjs', 'build/pdf.renderer.min.mjs', 'web/pdf_viewer.css'];
const PDFJS_FOLDERS = ['cmaps', 'standard_fonts', 'wasm', 'iccs', 'web/images'];

async function bundle(): Promise<void> {
    await build({
        input: join(cspDirectory, 'src/page.ts'),
        platform: 'browser',
        resolve: { extensionAlias: SOURCE_EXTENSIONS },
        output: { file: join(outDirectory, 'page.js'), format: 'esm' },
    });
    await build({
        input: join(cspDirectory, 'main.ts'),
        platform: 'node',
        external: ['electron'],
        output: { file: join(outDirectory, 'main.cjs'), format: 'cjs' },
    });
}

async function copyPdfjsAssets(): Promise<void> {
    for (const file of PDFJS_FILES) {
        await copyFile(join(pdfjsDirectory, file), join(outDirectory, file.split('/').pop() ?? file));
    }
    for (const folder of PDFJS_FOLDERS) {
        await cp(join(pdfjsDirectory, folder), join(outDirectory, folder.split('/').pop() ?? folder), { recursive: true });
    }
}

await mkdir(outDirectory, { recursive: true });
await bundle();
await copyPdfjsAssets();
await copyFile(join(cspDirectory, 'page.template.html'), join(outDirectory, 'page.template.html'));
console.log(`Gebaut nach ${outDirectory}`);

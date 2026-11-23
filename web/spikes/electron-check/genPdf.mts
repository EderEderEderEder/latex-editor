// Erzeugt ein synthetisches PDF (unkomprimierte Textseiten) der gewünschten Größe.
import { writeFile } from 'node:fs/promises';

const LINE_BYTES = 64;
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

function pageContent(page: number, lineCount: number): string {
    const rows: string[] = ['BT /F1 8 Tf 8 TL 20 820 Td'];
    for (let line = 0; line < lineCount; line++) {
        rows.push(`(Seite ${page} Zeile ${line} abcdefghijklmnopqrstuvwxyz 0123456789 ${(page * 7919 + line * 104729) % 100003}) '`);
    }
    rows.push('ET');
    return rows.join('\n');
}

export async function writeSyntheticPdf(file: string, targetBytes: number, pages: number): Promise<number> {
    const linesPerPage = Math.floor(targetBytes / pages / LINE_BYTES);
    const objects: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
    const kids: string[] = [];
    for (let page = 0; page < pages; page++) {
        const pageId = 4 + page * 2;
        kids.push(`${pageId} 0 R`);
        const content = pageContent(page + 1, linesPerPage);
        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`);
        objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    }
    objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`;
    let body = '%PDF-1.4\n';
    const offsets: number[] = [];
    objects.forEach((object, index) => {
        offsets.push(body.length);
        body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefStart = body.length;
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
    await writeFile(file, body, 'latin1');
    return body.length;
}

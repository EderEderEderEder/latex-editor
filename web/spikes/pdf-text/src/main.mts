// Minimales Electron-Hauptprogramm des Spikes S2: ein unsichtbares Fenster mit der Messseite. Gestartet von run.ts
// über Playwright (`_electron.launch`), die Messung selbst läuft in der Seite.
import { app, BrowserWindow } from "electron";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WINDOW_WIDTH = 1400;
const WINDOW_HEIGHT = 1000;
const spikeDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Nutzerdaten nicht in den Programmordner des Nutzers schreiben
app.setPath("userData", path.join(os.tmpdir(), "s2-pdftext", "electron-userdata"));

async function openMeasurementPage(): Promise<void> {
    const window = new BrowserWindow({
        show: false,
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
    });
    await window.loadFile(path.join(spikeDirectory, "page.html"));
}

app.whenReady().then(openMeasurementPage).catch((error: unknown) => {
    console.error("Messseite konnte nicht geöffnet werden:", error);
    app.exit(1);
});

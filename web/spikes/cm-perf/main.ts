// Minimales Electron-Hauptprogramm für die Messseite (Wegwerfcode, Spike S1).
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

const WINDOW_WIDTH = 1200;
const WINDOW_HEIGHT = 900;

// Ohne Bildratenbegrenzung misst „bis zum nächsten Rahmen“ die Arbeit, nicht das Warten auf VSync.
// Die Hintergrund-Drosselung bleibt aus, damit verdeckte Fenster gleich schnell messen.
app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('disable-gpu-vsync');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('js-flags', '--expose-gc');
// Sonst rundet Chromium performance.memory grob (Schutz vor Seitenkanälen).
app.commandLine.appendSwitch('enable-precise-memory-info');

function createWindow(): BrowserWindow {
    const window = new BrowserWindow({
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        title: 'Spike S1: CodeMirror-Leistung',
        show: false,
        webPreferences: {
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            backgroundThrottling: false,
            spellcheck: false,
        },
    });
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    // Ohne Fokus anzeigen, damit das Messfenster niemandem die Tastatur wegnimmt.
    window.once('ready-to-show', () => window.showInactive());
    void window.loadFile(join(__dirname, 'index.html'));
    return window;
}

app.on('window-all-closed', () => app.quit());
void app.whenReady().then(createWindow);

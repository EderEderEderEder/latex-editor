# Direkte Abhängigkeiten (web/)

Stand 2026-11-22, Versionen exakt gepinnt (`npm install --save-exact`), Lizenzen aus der `package.json` der installierten Pakete gelesen. Nur diese Pakete sind vom Nutzer freigegeben; `chokidar` und `nspell` sind Spike-abhängig und nicht installiert.

## dependencies

| Paket | Version | Lizenz | Zweck |
|---|---|---|---|
| react | 19.3.1 | MIT | Oberfläche |
| react-dom | 19.3.1 | MIT | React im Renderer |
| zustand | 5.1.0 | MIT | Stores je Bereich |
| @codemirror/state | 6.7.6 | MIT | Editor-Zustand |
| @codemirror/view | 6.43.15 | MIT | Editor-Ansicht |
| @codemirror/language | 6.13.1 | MIT | Sprachunterstützung, Einklappen |
| @codemirror/commands | 6.11.1 | MIT | Standardbefehle, Undo |
| @codemirror/search | 6.7.2 | MIT | Suchen/Ersetzen |
| @codemirror/autocomplete | 6.20.4 | MIT | Vervollständigung |
| @codemirror/lint | 6.9.8 | MIT | Diagnose |
| @lezer/highlight | 1.2.5 | MIT | Syntaxfarben |
| pdfjs-dist | 6.5.438 | Apache-2.0 | PDF-Anzeige |

## devDependencies

| Paket | Version | Lizenz | Zweck |
|---|---|---|---|
| electron | 45.4.1 | MIT | Laufzeit (Chromium + Node) |
| electron-vite | 6.0.0 | MIT | Build/Dev für Main, Preload, Renderer |
| electron-builder | 26.18.0 | MIT | Installer (NSIS, dmg, AppImage) |
| vite | 8.3.8 | MIT | Bundler |
| @vitejs/plugin-react | 6.3.0 | MIT | React in Vite |
| typescript | 7.0.2 | Apache-2.0 | Typprüfung |
| vitest | 4.1.12 | MIT | Unit-Tests |
| @playwright/test | 1.65.1 | Apache-2.0 | E2E-Tests (Electron) |
| ajv | 8.20.0 | MIT | JSON-Schema-Prüfung der Testvektoren |
| @types/react | 19.3.0 | MIT | Typen |
| @types/react-dom | 19.3.0 | MIT | Typen |
| @types/node | 26.6.6 | MIT | Typen |

## Auffälligkeiten

- Keine Lizenz außerhalb von MIT und Apache-2.0 bei den direkten Paketen.
- Transitive Pakete wurden nicht geprüft (`electron-builder` zieht viele). `npm install` meldet 6 Schwachstellen (moderate) und veraltete Pakete (`inflight`, `glob@7`, `rimraf@2`, `boolean`), vermutlich aus der Bauwerkzeug-Kette; nicht behoben.
- Das Electron-Programm wird erst beim ersten Start geladen (`node_modules/electron/install.js` läuft lazy), nicht bei `npm install`.

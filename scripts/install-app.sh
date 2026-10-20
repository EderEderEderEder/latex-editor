#!/bin/bash
# Baut die App und installiert sie als normales Programm nach /Applications (ersetzt die alte Version).
# Aufruf: scripts/install-app.sh
#
# Danach gibt es nur diese eine Kopie: build/LatexEditor.app wird entfernt, damit Spotlight nicht zwei anbietet.
# Welcher Stand installiert ist, zeigt „LatexEditor > Über LatexEditor“ (Commit und Build-Zeit).
set -euo pipefail

cd "$(dirname "$0")/.."
TARGET="/Applications/LatexEditor.app"
BUILT="build/LatexEditor.app"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

if pgrep -f "${TARGET}/Contents/MacOS/" >/dev/null; then
    echo "FEHLER: LatexEditor aus /Programme läuft noch. Bitte zuerst beenden (⌘Q), dann erneut aufrufen." >&2
    exit 1
fi

scripts/build-app.sh

echo "==> Installiere nach ${TARGET}"
rm -rf "${TARGET}"
ditto "${BUILT}" "${TARGET}"
"${LSREGISTER}" -f "${TARGET}"
"${LSREGISTER}" -u "${PWD}/${BUILT}" 2>/dev/null || true
rm -rf "${BUILT}"

echo "==> Installiert: $(/usr/libexec/PlistBuddy -c "Print :NSHumanReadableCopyright" "${TARGET}/Contents/Info.plist")"

#!/bin/bash
# Führt die Swift-Testing-Tests mit den Command Line Tools aus (ohne Xcode).
# Aufruf: scripts/test.sh [weitere swift-test-Argumente, z. B. --filter Performance]
#
# Hintergrund: Ohne die Flags wird der SwiftPM-Test-Runner ohne Swift Testing gebaut und
# meldet still "0 Tests, Exit 0". Das Skript schlägt deshalb auch fehl, wenn kein Testlauf erkannt wird.
set -uo pipefail

cd "$(dirname "$0")/.."

FRAMEWORKS="/Library/Developer/CommandLineTools/Library/Developer/Frameworks"
LIBRARIES="/Library/Developer/CommandLineTools/Library/Developer/usr/lib"

OUTPUT_FILE="$(mktemp -t latexeditor-test)"
trap 'rm -f "${OUTPUT_FILE}"' EXIT

swift test \
    -Xswiftc -F -Xswiftc "${FRAMEWORKS}" \
    -Xlinker -rpath -Xlinker "${FRAMEWORKS}" \
    -Xlinker -rpath -Xlinker "${LIBRARIES}" \
    "$@" 2>&1 | tee "${OUTPUT_FILE}"
STATUS=${PIPESTATUS[0]}

if [[ ${STATUS} -ne 0 ]]; then
    exit "${STATUS}"
fi
if ! grep -q "Test run with" "${OUTPUT_FILE}" || grep -q "Test run with 0 tests" "${OUTPUT_FILE}"; then
    echo "FEHLER: Es wurden keine Tests ausgeführt (Flags fehlen oder --filter ohne Treffer)." >&2
    exit 1
fi

#!/bin/bash
# Testlauf mit Überwachung und kurzer Zusammenfassung (für Menschen und für Claude: ein Aufruf, ca. 10 Zeilen Ausgabe).
#
# Aufruf: scripts/test-run.sh [--fast] [--stall SEKUNDEN] [--timeout SEKUNDEN] [swift-test-Argumente, z. B. --filter MarkActionsTests]
#   --fast     ohne die langsamen Fenster-, App- und Leistungstests (nur Logik; wenige Sekunden)
#   --stall    Abbruch, wenn die Ausgabe so lange nicht wächst (Standard 60)
#   --timeout  Abbruch nach so vielen Sekunden insgesamt (Standard 300)
#
# Bei einem Hänger wird mit `sample` aufgenommen, wo der Testprozess steht, danach nur der eigene Prozessbaum beendet.
# Bekannt unzuverlässige Tests (FLAKY) werden bei einem Fehlschlag einzeln bis zu zweimal wiederholt.
# Das ganze Log und die Aufnahme liegen in .build/test-logs/. Ausgang: 0 grün, 1 Fehler, 2 Hänger oder Zeitüberschreitung.
set -uo pipefail
cd "$(dirname "$0")/.."

STALL=60
TIMEOUT=300
FAST=0
ARGS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --fast) FAST=1 ;;
        --stall) STALL="$2"; shift ;;
        --timeout) TIMEOUT="$2"; shift ;;
        *) ARGS+=("$1") ;;
    esac
    shift
done

# Tests, die auch auf unverändertem Code gelegentlich fehlschlagen (Zeitmessung, Layout); nur zur Wiederholung gedacht
FLAKY='lineWrapping|statusDuration'
# Fenster-, App- und Leistungstests, die der schnelle Lauf auslässt
SLOW='AppModelSuite|PerformanceTests|Harness|WindowLayout'
if [[ ${FAST} -eq 1 ]]; then
    ARGS+=(--skip "${SLOW}" --skip "${FLAKY}")
fi

LOG_DIR=".build/test-logs"
mkdir -p "${LOG_DIR}"
LOG="${LOG_DIR}/last.log"
SAMPLE="${LOG_DIR}/stall-sample.txt"
rm -f "${SAMPLE}"

killtree() {
    local child
    for child in $(pgrep -P "$1" 2>/dev/null); do killtree "${child}"; done
    kill "$1" 2>/dev/null
}

# Der Testprozess im eigenen Prozessbaum (Name enthält swiftpm-testing-helper oder PackageTests); sonst das letzte Kind
test_process() {
    local pid="$1" child found
    for child in $(pgrep -P "${pid}" 2>/dev/null); do
        if ps -o command= -p "${child}" 2>/dev/null | grep -qE 'swiftpm-testing-helper|PackageTests'; then echo "${child}"; return; fi
        found=$(test_process "${child}")
        if [[ -n "${found}" ]]; then echo "${found}"; return; fi
    done
}

take_sample() {
    local target
    target=$(test_process "$1")
    [[ -n "${target}" ]] && sample "${target}" 3 -file "${SAMPLE}" >/dev/null 2>&1
}

# Läuft `scripts/test.sh` mit Argumenten im Hintergrund und überwacht es. Rückgabe: 0 fertig, 2 Hänger/Zeit.
run_watched() {
    local log="$1"; shift
    scripts/test.sh "$@" > "${log}" 2>&1 &
    local pid=$!
    local started=${SECONDS} last_size=-1 last_change=${SECONDS}
    while kill -0 "${pid}" 2>/dev/null; do
        sleep 2
        local size
        size=$(stat -f %z "${log}" 2>/dev/null || echo 0)
        if [[ "${size}" != "${last_size}" ]]; then last_size=${size}; last_change=${SECONDS}; fi
        if (( SECONDS - last_change >= STALL )); then
            STALL_REASON="Ausgabe wuchs ${STALL} s lang nicht"
            take_sample "${pid}"
            killtree "${pid}"; wait "${pid}" 2>/dev/null; return 2
        fi
        if (( SECONDS - started >= TIMEOUT )); then
            STALL_REASON="mehr als ${TIMEOUT} s insgesamt"
            take_sample "${pid}"
            killtree "${pid}"; wait "${pid}" 2>/dev/null; return 2
        fi
    done
    wait "${pid}"
    return 0
}

# Namen der fehlgeschlagenen Tests ("✘ Test "…" failed"), eindeutig
failed_tests() {
    grep -E '^✘ Test ".*" failed' "$1" | sed -E 's/^✘ Test "(.*)" failed.*$/\1/' | sort -u
}

summarize() {
    local log="$1"
    grep -E '^(✔|✘) Test run with' "$log" | tail -1
    local failed
    failed=$(failed_tests "$log")
    if [[ -n "${failed}" ]]; then
        echo "Fehlgeschlagen:"
        while IFS= read -r name; do
            echo "  - ${name}"
            grep -F "✘ Test \"${name}\" recorded an issue" "$log" | head -2 | sed -E 's/^.*recorded an issue at /      /' | cut -c1-220
        done <<< "${failed}"
    fi
    local slow
    slow=$(grep -E '^✔ Test ".*" passed after [0-9.]+ seconds' "$log" | sed -E 's/^✔ Test "(.*)" passed after ([0-9.]+) seconds.*$/\2 \1/' | sort -rn | head -3)
    [[ -n "${slow}" ]] && echo "Langsamste:" && echo "${slow}" | awk '$1 >= 5 {print "  " $0}' | cut -c1-120
    return 0
}

STALL_REASON=""
run_watched "${LOG}" ${ARGS[@]+"${ARGS[@]}"}
WATCH=$?

if [[ ${WATCH} -eq 2 ]]; then
    echo "HÄNGER: ${STALL_REASON}. Bis dahin ${LOG_DIR}/last.log: $(grep -cE '^(✔|✘) Test ' "${LOG}") Ergebnisse."
    if [[ -f "${SAMPLE}" ]]; then
        echo "Hauptthread laut Aufnahme (${SAMPLE}):"
        grep -m1 -A12 'Thread_.*DispatchQueue_1: com.apple.main-thread' "${SAMPLE}" | grep -E 'LatexEditor|AppKit|SwiftUI|PDFKit|Foundation' | head -6 | cut -c1-160
    fi
    echo "Zuletzt begonnen:"
    grep -E '^◇ Test ".*" started' "${LOG}" | tail -3 | cut -c1-140
    exit 2
fi

summarize "${LOG}"
if ! grep -qE '^(✔|✘) Test run with' "${LOG}"; then
    echo "KEIN ERGEBNIS: Der Lauf endete ohne Zusammenfassung (Übersetzungsfehler?). Ende von ${LOG}:"
    tail -15 "${LOG}" | cut -c1-200
    exit 1
fi
if grep -qE '^✔ Test run with' "${LOG}"; then exit 0; fi

# Nur bekannt unzuverlässige Tests fehlgeschlagen? Einzeln wiederholen.
REAL=$(failed_tests "${LOG}" | grep -vE "${FLAKY}" || true)
if [[ -z "${REAL}" ]]; then
    for attempt in 1 2; do
        run_watched "${LOG_DIR}/retry.log" --filter "${FLAKY}"
        if grep -qE '^✔ Test run with' "${LOG_DIR}/retry.log"; then
            echo "Nur bekannt unzuverlässige Tests fehlgeschlagen; einzeln wiederholt: bestanden (Versuch ${attempt})."
            exit 0
        fi
    done
    echo "Die bekannt unzuverlässigen Tests schlagen auch einzeln fehl: echter Fehler?"
fi
exit 1

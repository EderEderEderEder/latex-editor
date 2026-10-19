#!/bin/bash
# Legt eine Arbeitskopie des Demo-Projekts mit Git-Repository an, zum Ausprobieren in der App.
# Aufruf: scripts/demo-projekt.sh [Zielordner]   (Standard: Testdaten/Arbeitskopie, wird neu angelegt)
#
# Die Vorlage in Testdaten/HgbDemo bleibt unverändert. Die Arbeitskopie hat einen Commit und danach
# bereitgestellte, nicht bereitgestellte und neue Änderungen, damit der Änderungen-Tab etwas zeigt.
# Git läuft ohne die globale Konfiguration des Nutzers; Name und E-Mail stehen nur im Demo-Repository.
set -euo pipefail

cd "$(dirname "$0")/.."
SOURCE="Testdaten/HgbDemo"
DEFAULT_TARGET="Testdaten/Arbeitskopie"
TARGET="${1:-$DEFAULT_TARGET}"
GIT="/usr/local/bin/git"
[[ -x "$GIT" ]] || GIT="$(xcode-select -p)/usr/bin/git"

if [[ -e "$TARGET" ]]; then
    if [[ "$TARGET" != "$DEFAULT_TARGET" ]]; then
        echo "FEHLER: $TARGET existiert schon. Bitte einen neuen Ordner angeben." >&2
        exit 1
    fi
    rm -rf "$DEFAULT_TARGET"
fi

mkdir -p "$TARGET"
cp -R "$SOURCE"/ "$TARGET"/
cd "$TARGET"

export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
"$GIT" init --quiet --initial-branch=main
"$GIT" config user.name "Demo Person"
"$GIT" config user.email "demo@example.com"
printf '*.aux\n*.log\n*.pdf\n*.synctex.gz\n*.bbl\n*.bcf\n*.blg\n*.run.xml\n*.toc\n*.lof\n*.lot\n*.out\n*.fls\n*.fdb_latexmk\n' > .gitignore
"$GIT" add --all
"$GIT" commit --quiet --message "Demo-Projekt"

# Bereitgestellt, nicht bereitgestellt und neu
printf '\nEin bereitgestellter Satz.\n' >> chapters/grundlagen.tex
"$GIT" add chapters/grundlagen.tex
printf '\nEin Satz, der noch nicht bereitgestellt ist.\n' >> chapters/einleitung.tex
printf '%% Notizen, noch nicht im Repository\nTODO: Kapitel Umsetzung erweitern.\n' > notizen.tex

echo "Demo-Projekt: $(pwd)"

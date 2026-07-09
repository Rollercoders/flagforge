#!/usr/bin/env bash
# Calcola la prossima versione da LAST_TAG + COMMIT_MSG secondo i conventional commit.
# Stampa la versione nuda (es. 0.2.2) se c'è da rilasciare, altrimenti stampa nulla.
set -euo pipefail

last="${LAST_TAG:-}"
msg="${COMMIT_MSG:-}"

# Normalizza il tag: togli il prefisso v, default 0.0.0
last="${last#v}"
[ -z "$last" ] && last="0.0.0"

# Scarta eventuali suffissi di pre-release/build (-rc.1, +build) prima
# dell'aritmetica, altrimenti "read" produce campi non numerici.
last="${last%%-*}"
last="${last%%+*}"
[ -z "$last" ] && last="0.0.0"

IFS='.' read -r major minor patch <<< "$last"
major="${major:-0}"; minor="${minor:-0}"; patch="${patch:-0}"

# Determina il tipo di bump dal messaggio del commit.
# Il breaking change (! prima dei due punti, con scope opzionale, su
# qualsiasi tipo, oppure BREAKING CHANGE nel corpo) va controllato PRIMA
# di feat:/fix:, altrimenti "feat!:" verrebbe intercettato da "feat:".
bump=""
if printf '%s' "$msg" | grep -qE '^[a-zA-Z]+(\(.+\))?!:' || printf '%s' "$msg" | grep -qE 'BREAKING CHANGE'; then
  bump="major"
elif printf '%s' "$msg" | grep -qE '^feat(\(.+\))?:'; then
  bump="minor"
elif printf '%s' "$msg" | grep -qE '^(fix|revert)(\(.+\))?:'; then
  bump="patch"
fi

case "$bump" in
  major) major=$((major + 1)); minor=0; patch=0 ;;
  minor) minor=$((minor + 1)); patch=0 ;;
  patch) patch=$((patch + 1)) ;;
  *) exit 0 ;;  # nessun rilascio: nessun output
esac

printf '%s.%s.%s\n' "$major" "$minor" "$patch"

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

# Valida che la base sia una tripla numerica valida: un tag malformato
# (es. "vfoo") non deve produrre output-spazzatura silenzioso.
if ! printf '%s' "$last" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "next-version.sh: LAST_TAG malformato, base non valida: '$last'" >&2
  exit 1
fi

IFS='.' read -r major minor patch <<< "$last"
major="${major:-0}"; minor="${minor:-0}"; patch="${patch:-0}"

# Determina il tipo di bump dal messaggio del commit.
# Il breaking change (! prima dei due punti, con scope opzionale, su
# qualsiasi tipo) va controllato PRIMA di feat:/fix:, altrimenti "feat!:"
# verrebbe intercettato da "feat:". Nota: il chiamante passa solo il subject
# del commit, quindi "BREAKING CHANGE" (che vive nel footer per Conventional
# Commits) non va controllato qui: non comparirebbe mai legittimamente nel
# subject, e una menzione innocua (es. "docs: nota su BREAKING CHANGE")
# causerebbe un major spurio.
bump=""
if printf '%s' "$msg" | grep -qE '^[a-zA-Z]+(\(.+\))?!:'; then
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

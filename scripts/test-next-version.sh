#!/usr/bin/env bash
# Test per next-version.sh. Esegue casi noti e verifica l'output.
set -u
SCRIPT="$(dirname "$0")/next-version.sh"
fail=0

check() {
  local desc="$1" last="$2" msg="$3" expected="$4"
  local got
  got="$(LAST_TAG="$last" COMMIT_MSG="$msg" bash "$SCRIPT")"
  if [ "$got" != "$expected" ]; then
    echo "FAIL: $desc → atteso '[$expected]', ottenuto '[$got]'"
    fail=1
  else
    echo "ok: $desc → '$got'"
  fi
}

check "fix bumpa patch"            "v0.2.1" "fix: bug (#17)"            "0.2.2"
check "feat bumpa minor"           "v0.2.1" "feat: cosa (#18)"         "0.3.0"
check "feat! bumpa major"          "v0.2.1" "feat!: rottura (#19)"     "1.0.0"
check "revert bumpa patch"         "v0.2.1" "revert: x (#20)"          "0.2.2"
check "chore non rilascia"         "v0.2.1" "chore: deps (#21)"        ""
check "docs non rilascia"          "v0.2.1" "docs: readme (#22)"       ""
check "commit dependabot non rilascia" "v0.2.1" "chore(deps): bump x"  ""
check "nessun tag parte da 0.0.0"  ""       "fix: primo (#1)"          "0.0.1"
check "nessun tag + feat"          "v0.0.0" "feat: primo (#1)"         "0.1.0"

check "feat(scope)! bumpa major"   "v0.2.1" "feat(scope)!: rottura (#23)" "1.0.0"
check "fix! bumpa major"           "v0.2.1" "fix!: rottura (#24)"      "1.0.0"
check "refactor! bumpa major"      "v0.2.1" "refactor!: rottura (#25)" "1.0.0"
check "feat(api) con scope bumpa minor" "v0.2.1" "feat(api): cosa (#26)" "0.3.0"
check "fix(core) con scope bumpa patch" "v0.2.1" "fix(core): bug (#27)" "0.2.2"
check "tag pre-release + fix"      "v0.2.1-rc.1" "fix: x (#28)"        "0.2.2"

exit $fail

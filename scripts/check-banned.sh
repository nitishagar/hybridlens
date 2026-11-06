#!/usr/bin/env bash
# scripts/check-banned.sh — I7 secret gate (voltbase check-banned.sh pattern).
#
# Usage: bash scripts/check-banned.sh [file ...]
# With no args, scans every git-tracked + untracked-but-not-ignored file
# (`git ls-files --cached --others --exclude-standard`). The gate itself and
# the banned fixture dir are excluded: they must cite the matched strings.
# With args, scans exactly those files (used by the positive-control test).
#
# NOTE: patterns are built by concatenation so this file never matches itself.
set -euo pipefail

secret_re="AI""za[0-9A-Za-z_-]{20,}|FIREBASE_APPCHECK_DEBUG_TO""KEN[[:space:]]*=[[:space:]]*[\"'][^\"']+[\"']|-----BEGIN [A-Z ]*PRIV""ATE KEY-----"

files=()
if [ "$#" -gt 0 ]; then
  files=("$@")
else
  while IFS= read -r -d '' f; do
    case "$f" in
      scripts/check-banned.sh|tests/fixtures/banned/*) continue ;;
      *) files+=("$f") ;;
    esac
  done < <(git ls-files --cached --others --exclude-standard -z)
fi

hits=0
for f in ${files[@]+"${files[@]}"}; do
  [ -f "$f" ] || continue
  if grep -HnE -- "$secret_re" "$f"; then hits=1; fi
done

if [ "$hits" -ne 0 ]; then
  echo "check-banned: FAIL — banned content found (see hits above)" >&2
  exit 1
fi
echo "check-banned: OK"

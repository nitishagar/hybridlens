#!/usr/bin/env bash
# scripts/verify.sh — typecheck -> lint -> build -> test -> smoke -> banned.
set -euo pipefail
npm run typecheck
npm run lint
npm run build
npm test
npm run smoke
bash scripts/check-banned.sh
echo "verify: OK"

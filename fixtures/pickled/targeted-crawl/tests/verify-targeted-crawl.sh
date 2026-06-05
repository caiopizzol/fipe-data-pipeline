#!/usr/bin/env bash
set -euo pipefail

test -f README.md
test -f scripts/crawl-vw-june-2024.sh
test -x scripts/crawl-vw-june-2024.sh

grep -Fq "set -euo pipefail" scripts/crawl-vw-june-2024.sh
grep -Fq "bun run db:push" scripts/crawl-vw-june-2024.sh
grep -Fq "bun run crawl -- --brand 59 --year 2024 --month 6" scripts/crawl-vw-june-2024.sh
grep -Fq "bun run status" scripts/crawl-vw-june-2024.sh

if grep -R "npm\\|--force\\|--classify" scripts/crawl-vw-june-2024.sh >/dev/null; then
  echo "targeted crawl should not use npm, --force, or --classify" >&2
  exit 1
fi

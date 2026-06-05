Create `scripts/crawl-vw-june-2024.sh`.

The script should:

- be executable
- use `set -euo pipefail`
- run `bun run db:push`
- run `bun run crawl -- --brand 59 --year 2024 --month 6`
- run `bun run status`

Do not use npm. Do not add `--force`. Do not add `--classify`.

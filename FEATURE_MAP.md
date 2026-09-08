# Feature map

## Preview models waiting for classification

`classify --dry-run` lists models that need a segment label, without calling AI or saving changes.
It shows up to 20 models and counts the rest. `-n` is the short form of `--dry-run`.

**Verified:** Bun CLI, version 1.14.1, in two clean checkouts with fresh databases.

### Try it

You'll need Bun, running Docker, and Bash or Zsh. Start at the repo root in a clean checkout with
no `.env` file. This uses a temporary PostgreSQL 17 database. No AI key is needed.

```sh
bun install --frozen-lockfile
fipe_preview_container=$(docker run --rm -d -e POSTGRES_PASSWORD=preview \
  -p 127.0.0.1::5432 postgres:17-alpine)
for attempt in $(seq 1 30); do
  docker exec "$fipe_preview_container" pg_isready -h 127.0.0.1 -U postgres && break
  sleep 1
done
fipe_preview_address=$(docker port "$fipe_preview_container" 5432/tcp)
export DATABASE_URL="postgres://postgres:preview@$fipe_preview_address/postgres"
bun run db:migrate
docker exec -i "$fipe_preview_container" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO brands (fipe_code, name) VALUES ('preview', 'Preview Brand');
INSERT INTO models (brand_id, fipe_code, name, segment)
SELECT id, 'pending', 'Pending Model', NULL FROM brands WHERE fipe_code = 'preview';
INSERT INTO models (brand_id, fipe_code, name, segment)
SELECT id, 'done', 'Labeled Model', 'SUV' FROM brands WHERE fipe_code = 'preview';
SQL
bun src/index.ts classify --help
bun src/index.ts classify --dry-run
docker exec "$fipe_preview_container" psql -U postgres -v ON_ERROR_STOP=1 -c \
  "SELECT name, segment FROM models ORDER BY name;"
docker stop "$fipe_preview_container"
unset DATABASE_URL fipe_preview_container fipe_preview_address
```

Once the database is ready, each command should exit zero. The preview should show:

```text
Found 1 models without segment.

Dry run - would classify:
  - Preview Brand Pending Model
```

`Labeled Model` should stay out of the preview. The SQL result should still show its `SUV` label
and a blank label for `Pending Model`. Both runs passed these checks.

If the database won't start or a later command fails, stop and clean up with
`docker stop "$fipe_preview_container"`.

### Where to look

- [src/index.ts](src/index.ts) defines `classify`, `--dry-run`, and `-n`. [src/commands/classify.ts](src/commands/classify.ts) returns before
  calling AI or saving labels. Use these CLI names for automation; output wording isn't a stable
  selector. There are no UI selectors or keyboard shortcuts.
- [src/db/repository.ts](src/db/repository.ts): `getModelsWithoutSegment` finds unlabeled models
  and their brand names.

### Test limits

No automated test runs this route. Help output only confirms the flags. This replay checks the
preview and unchanged labels, not AI accuracy, saving labels, or the 20-model limit.

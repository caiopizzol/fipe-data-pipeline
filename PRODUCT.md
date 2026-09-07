# FIPE Data Pipeline

This is the data pipeline behind fipe.chat. It collects historical FIPE car prices into PostgreSQL
for people who maintain or build on that data. Run it with Bun; see [README.md](README.md) for setup
and commands.

## What's in scope

We collect prices, save crawl progress, publish monthly data, add optional AI segment labels, and
back up the database. The website, public API, and scheduler live outside this repo. FIPE supplies
the prices; AI labels are our own additions.

**Cars only:** the [FIPE client](src/fipe/client.ts) requests vehicle type 1. The README mentions
motorcycles and trucks as part of FIPE's coverage, but this pipeline doesn't collect those types.

## What it does

Commands below run with `bun src/index.ts <command>`.

| Capability                                                                                                   | Commands                                   | Main code                                                                                                | Existing checks                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Collect price history with date, reference, brand, and model filters. Resume saved progress and show totals. | `crawl`, `status`                          | [Crawler](src/crawler/processor.ts), [FIPE client](src/fipe/client.ts), [database](src/db/repository.ts) | [Month parsing test](src/crawler/reference.test.ts). No full crawl test; `status` shows counts, not completeness.                                                                               |
| Publish new months in order and retry unfinished view updates and backups.                                   | `refresh [--backup]`                       | [Refresh](src/crawler/refresh.ts), [database](src/db/repository.ts), [SQL](initial.sql)                  | [Refresh tests](src/crawler/refresh.test.ts) cover rules and retries. [SQL tests](src/db/latest-prices.test.ts) check published-only prices in PostgreSQL for the initial schema and migration. |
| Add optional AI segment labels to models.                                                                    | `classify [--dry-run]`, `crawl --classify` | [Classifier](src/classifier/segment-classifier.ts), [CLI](src/index.ts)                                  | Dry run lists candidates without calling AI or saving labels. No automated accuracy tests.                                                                                                      |
| Save database backups to S3-compatible storage and check they restore.                                       | `backup`, `restore-drill`                  | [Backup](src/backup.ts)                                                                                  | Restore drill loads the latest daily backup into a scratch database and checks that `prices` has rows. Requires live database and storage access.                                               |

## How publishing works

The current focus is reliable monthly updates that can pick up after a failure.

- `crawl` saves data but doesn't publish a new month. Raw tables may contain unfinished work.
- `refresh` publishes only when no recorded crawl work remains and the price count reaches 90% of
  the previous published month's count. The first month has no price-count minimum. These checks
  don't prove that every vehicle was collected.
- `latest_prices` holds the latest published price for each model-year. Only references with
  `published_at` set can appear there.
- A database lock prevents two refreshes from running together. It doesn't block standalone crawls.
  Optional healthcheck pings report results; an external scheduler starts the job.

The data shape lives in [initial.sql](initial.sql), [schema.ts](src/db/schema.ts), and
[migrations/](migrations/). No broader roadmap is recorded here.

## Checking changes

Run `bun run check` for formatting, lint, types, and tests. Docker must be running for the isolated
PostgreSQL test. It checks `latest_prices` before and after publication using the tracked SQL.
Live crawling, database locks, AI output, and backups still need separate checks. The restore drill
is available for operators; this map doesn't claim it has been run.

#!/usr/bin/env bun
import { Command, Option } from 'commander';
import { version } from '../package.json';
import { parseCodes, parseInteger, parseNumberList } from './cli-options.js';
import {
  readBackupConfig,
  readClassificationKey,
  readCrawlerConfig,
  readDatabaseConfig,
} from './config.js';
import { createConnection } from './db/connection.js';
import { type Repository, createRepository } from './db/repository.js';

export function createProgram() {
  const program = new Command()
    .name('fipe')
    .description('FIPE vehicle pricing pipeline')
    .version(version);
  async function withDatabase(work: (repo: Repository) => Promise<unknown>, lock = false) {
    const connection = createConnection(readDatabaseConfig().DATABASE_URL);
    let failure: unknown;
    try {
      const run = () => work(createRepository(connection.db));
      if (lock) await connection.withCrawlLock(run);
      else await run();
    } catch (error) {
      failure = error;
    }
    try {
      await connection.close();
    } catch (error) {
      const errors = failure ? [failure, error] : [error];
      failure = new AggregateError(
        errors,
        errors.map((e) => (e instanceof Error ? e.message : String(e))).join('; '),
      );
    }
    if (failure) throw failure;
  }

  program
    .command('crawl')
    .description('Crawl FIPE car prices and resume unfinished work')
    .addOption(
      new Option('-r, --reference <code>', 'Reference table code')
        .argParser((v) => parseInteger(v))
        .conflicts(['year', 'month']),
    )
    .option('-y, --year <years>', 'Year, list or range (default: current year)', (v) =>
      parseNumberList(v, 2001, 9999),
    )
    .option('-M, --month <months>', 'Month, list or range', (v) => parseNumberList(v, 1, 12))
    .option('-b, --brand <codes>', 'Brand codes, comma-separated', parseCodes)
    .addOption(
      new Option('-m, --model <codes>', 'Model codes (requires --brand)').argParser(parseCodes),
    )
    .option('-c, --classify', 'Classify newly discovered models with AI')
    .option('-f, --force', 'Re-fetch the selected scope')
    .action(async (options) => {
      if (options.model && !options.brand) program.error('--model requires --brand');
      const config = readCrawlerConfig();
      const apiKey = options.classify ? readClassificationKey() : undefined;
      const { crawl } = await import('./commands/crawl.js');
      const { FipeClient } = await import('./fipe/client.js');
      const classifyModel = apiKey
        ? (await import('./classifier/classify.js')).createClassifier(apiKey).classifySingleModel
        : undefined;
      await withDatabase(async (repo) => {
        const result = await crawl(
          {
            referenceCode: options.reference,
            years: options.year,
            months: options.month,
            brandCodes: options.brand,
            modelCodes: options.model,
            force: options.force,
            refreshLatestPrices: config.REFRESH_LATEST_PRICES,
          },
          repo,
          new FipeClient(config),
          classifyModel,
        );
        if (result.failed)
          throw new Error(`Crawl incomplete: ${result.failed} failures; re-run to resume`);
      }, true);
    });

  program
    .command('status')
    .description('Show stored data and reference coverage')
    .option('-r, --reference <code>', 'Reference table code', (v) => parseInteger(v))
    .action(async (options) => {
      const { status } = await import('./commands/status.js');
      await withDatabase((repo) => status(repo, options.reference));
    });
  program
    .command('classify')
    .description('Classify models without segments')
    .option('-n, --dry-run', 'Preview without calling the classification API')
    .action(async (options) => {
      const key = options.dryRun ? '' : readClassificationKey();
      const { classify } = await import('./commands/classify.js');
      await withDatabase((repo) => classify(repo, Boolean(options.dryRun), key));
    });
  program
    .command('backup')
    .description('Upload a PostgreSQL backup to S3/R2 with retention')
    .action(async () => {
      const { createBackupCommands } = await import('./commands/backup.js');
      await createBackupCommands(readBackupConfig()).runBackup();
    });
  program
    .command('restore-drill')
    .description('Verify the latest backup in a temporary database')
    .action(async () => {
      const { createBackupCommands } = await import('./commands/backup.js');
      await createBackupCommands(readBackupConfig()).runRestoreDrill();
    });
  return program;
}

if (import.meta.main) {
  try {
    await createProgram().parseAsync();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

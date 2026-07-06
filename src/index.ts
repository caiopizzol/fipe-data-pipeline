#!/usr/bin/env node
import { Command } from 'commander';
import { runBackup, runRestoreDrill } from './backup.js';
import { classifyModels } from './classifier/segment-classifier.js';
import { crawl, status } from './crawler/processor.js';
import { runRefresh } from './crawler/refresh.js';
import { closeConnection } from './db/connection.js';
import { getModelsWithoutSegment, updateModelSegment } from './db/repository.js';

const program = new Command();

/**
 * Parse a flexible number input (single value, range, or list)
 * Examples: "2023" -> [2023], "2020-2023" -> [2020,2021,2022,2023], "1,3,6" -> [1,3,6]
 */
function parseNumberList(value: string): number[] {
  const results: number[] = [];
  for (const part of value.split(',')) {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map((v) => Number.parseInt(v.trim(), 10));
      for (let i = start; i <= end; i++) {
        results.push(i);
      }
    } else {
      results.push(Number.parseInt(part.trim(), 10));
    }
  }
  return [...new Set(results)].sort((a, b) => a - b);
}

function parseCommaSeparated(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
}

function markCommandFailed(): void {
  process.exitCode = 1;
}

program
  .command('crawl')
  .description('Crawl FIPE data and store in database')
  .option('-r, --reference <code>', 'Specific reference table code')
  .option('-y, --year <year>', 'Year(s) to crawl (e.g., 2023, 2020-2023, or 2020,2022,2023)')
  .option('-M, --month <month>', 'Month(s) to crawl (e.g., 6, 1-6, or 1,3,6)')
  .option('-b, --brand <codes>', 'Brand code(s), comma-separated')
  .option('-m, --model <codes>', 'Model code(s), comma-separated (requires --brand)')
  .option('-c, --classify', 'Classify new models by segment using AI')
  .option('-f, --force', 'Re-fetch all data, ignoring sync status')
  .action(async (options) => {
    try {
      await crawl({
        referenceCode: options.reference ? Number.parseInt(options.reference, 10) : undefined,
        years: options.year ? parseNumberList(options.year) : undefined,
        months: options.month ? parseNumberList(options.month) : undefined,
        brandCodes: options.brand ? parseCommaSeparated(options.brand) : undefined,
        modelCodes: options.model ? parseCommaSeparated(options.model) : undefined,
        classify: options.classify,
        force: options.force,
      });
    } catch (err) {
      console.error('Crawl failed:', err);
      markCommandFailed();
    }
  });

program
  .command('status')
  .description('Show database statistics')
  .action(async () => {
    try {
      await status();
    } catch (err) {
      console.error('Status failed:', err);
      markCommandFailed();
    }
  });

program
  .command('classify')
  .description('Classify models by segment using AI')
  .option('-n, --dry-run', 'Show what would be classified without making changes')
  .action(async (options) => {
    try {
      // Batch classification
      const modelsToClassify = await getModelsWithoutSegment();

      if (modelsToClassify.length === 0) {
        console.log('All models are already classified.');
        return;
      }

      console.log(`Found ${modelsToClassify.length} models without segment.`);

      if (options.dryRun) {
        console.log('\nDry run - would classify:');
        for (const model of modelsToClassify.slice(0, 20)) {
          console.log(`  - ${model.brandName} ${model.modelName}`);
        }
        if (modelsToClassify.length > 20) {
          console.log(`  ... and ${modelsToClassify.length - 20} more`);
        }
        return;
      }

      console.log('\nClassifying models...');
      const results = await classifyModels(modelsToClassify);

      let classified = 0;
      let failed = 0;

      for (const result of results) {
        if (result.segment) {
          await updateModelSegment(result.id, result.segment, 'ai');
          classified++;
        } else {
          failed++;
        }
      }

      console.log(`\nDone! Classified: ${classified}, Failed: ${failed}`);
    } catch (err) {
      console.error('Classification failed:', err);
      markCommandFailed();
    }
  });

program
  .command('refresh')
  .description('Crawl and publish new complete FIPE reference tables')
  .option('--backup', 'Run backup after publishing at least one reference')
  .action(async (options: { backup?: boolean }) => {
    const exitCode = await runRefresh({ backup: options.backup === true });
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  });

program
  .command('backup')
  .description('pg_dump the database and upload to R2 with retention')
  .action(async () => {
    try {
      await runBackup();
    } catch (err) {
      console.error('Backup failed:', err);
      markCommandFailed();
    }
  });

program
  .command('restore-drill')
  .description('Download the latest R2 backup and verify it restores into a scratch database')
  .action(async () => {
    try {
      await runRestoreDrill();
    } catch (err) {
      console.error('Restore drill failed:', err);
      markCommandFailed();
    }
  });

async function main() {
  try {
    await program.parseAsync();
  } finally {
    await closeConnection();
  }
}

main().catch((err) => {
  console.error('Command failed:', err);
  markCommandFailed();
});

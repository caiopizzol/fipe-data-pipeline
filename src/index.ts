#!/usr/bin/env node
import { Command } from 'commander';
import { crawl, status } from './crawler/processor.js';
import { classifyModels } from './classifier/segment-classifier.js';
import { getModelsWithoutSegment, updateModelSegment } from './db/repository.js';
import { closeConnection } from './db/connection.js';

const program = new Command();

/**
 * Parse a flexible number input (single value, range, or list)
 * Examples: "2023" -> [2023], "2020-2023" -> [2020,2021,2022,2023], "1,3,6" -> [1,3,6]
 */
function parseNumberList(value: string): number[] {
  const results: number[] = [];
  for (const part of value.split(',')) {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map((v) => parseInt(v.trim(), 10));
      for (let i = start; i <= end; i++) {
        results.push(i);
      }
    } else {
      results.push(parseInt(part.trim(), 10));
    }
  }
  return [...new Set(results)].sort((a, b) => a - b);
}

program
  .command('crawl')
  .description('Crawl FIPE data and store in database')
  .option('-r, --reference <code>', 'Specific reference table code')
  .option('-y, --year <year>', 'Year(s) to crawl (e.g., 2023, 2020-2023, or 2020,2022,2023)')
  .option('-M, --month <month>', 'Month(s) to crawl (e.g., 6, 1-6, or 1,3,6)')
  .option('-b, --brand <code>', 'Specific brand code')
  .option('-m, --model <code>', 'Specific model code (requires --brand)')
  .option('-c, --classify', 'Classify new models by segment using AI')
  .action(async (options) => {
    try {
      await crawl({
        referenceCode: options.reference ? parseInt(options.reference, 10) : undefined,
        years: options.year ? parseNumberList(options.year) : undefined,
        months: options.month ? parseNumberList(options.month) : undefined,
        brandCode: options.brand,
        modelCode: options.model,
        classify: options.classify,
      });
    } catch (err) {
      console.error('Crawl failed:', err);
      process.exit(1);
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
      process.exit(1);
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
      process.exit(1);
    }
  });

async function main() {
  await program.parseAsync();
  await closeConnection();
}

main();

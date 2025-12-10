#!/usr/bin/env node
import { Command } from 'commander';
import { crawl, status } from './crawler/processor.js';
import { classifyModels } from './classifier/segment-classifier.js';
import { getModelsWithoutSegment, updateModelSegment } from './db/repository.js';
import { closeConnection } from './db/connection.js';

const program = new Command();

program
  .command('crawl')
  .description('Crawl FIPE data and store in database')
  .option('-r, --reference <code>', 'Specific reference table code')
  .option('-y, --year <year>', 'Year to crawl (default: current year)')
  .option('-b, --brand <code>', 'Specific brand code')
  .option('-m, --model <code>', 'Specific model code (requires --brand)')
  .option('-c, --classify', 'Classify new models by segment using AI')
  .action(async (options) => {
    try {
      await crawl({
        referenceCode: options.reference ? parseInt(options.reference, 10) : undefined,
        year: options.year ? parseInt(options.year, 10) : undefined,
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

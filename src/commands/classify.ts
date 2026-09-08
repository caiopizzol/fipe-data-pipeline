import { createClassifier } from '../classifier/classify.js';
import type { Repository } from '../db/repository.js';

export async function classify(repo: Repository, dryRun: boolean, apiKey: string) {
  const modelsToClassify = await repo.getModelsWithoutSegment();

  if (modelsToClassify.length === 0) {
    console.log('All models are already classified.');
    return;
  }

  console.log(`Found ${modelsToClassify.length} models without segment.`);

  if (dryRun) {
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
  const results = await createClassifier(apiKey).classifyModels(modelsToClassify);

  let classified = 0;
  let failed = 0;

  for (const result of results) {
    if (result.segment) {
      await repo.updateModelSegment(result.id, result.segment, 'ai');
      classified++;
    } else {
      failed++;
    }
  }

  console.log(`\nClassified: ${classified}, Failed: ${failed}`);
  if (failed) throw new Error(`${failed} models could not be classified; re-run classify to retry`);
}

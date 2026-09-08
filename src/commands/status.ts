import type { Repository } from '../db/repository.js';

export async function status(repo: Repository, referenceCode?: number): Promise<void> {
  if (referenceCode !== undefined) {
    const progress = await repo.getReferenceCrawlProgress(referenceCode);

    if (!progress) {
      throw new Error(`Reference ${referenceCode} not found`);
    }

    const pending = progress.brands.pending + progress.models.pending + progress.modelYears.pending;

    console.log(`\nReference ${progress.code} (${progress.month}/${progress.year}):`);
    console.log(
      `  Brands (models fetched):     ${progress.brands.total - progress.brands.pending}/${progress.brands.total}`,
    );
    console.log(
      `  Models (years fetched):      ${progress.models.total - progress.models.pending}/${progress.models.total}`,
    );
    console.log(
      `  Model-years (price fetched): ${progress.modelYears.total - progress.modelYears.pending}/${progress.modelYears.total}`,
    );
    console.log(`  Prices stored:               ${progress.prices}`);
    console.log(
      pending === 0 && progress.completedAt && progress.brands.total > 0
        ? '  Status: complete'
        : `  Status: INCOMPLETE or scoped (${pending} known pending) - re-run crawl --reference ${progress.code} to resume`,
    );
    return;
  }

  const stats = await repo.getStats();
  console.log('\nDatabase status:');
  console.log(`  References: ${stats.references}`);
  console.log(`  Brands: ${stats.brands}`);
  console.log(`  Models: ${stats.models}`);
  console.log(`  Prices: ${stats.prices}`);
}

import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Segment } from '../classifier/segments.js';
import type { Database } from './connection.js';
import {
  brands,
  modelYears,
  models,
  prices,
  referenceBrands,
  referenceModelYears,
  referenceModels,
  referenceTables,
} from './schema.js';

export interface CrawlScope {
  brandCodes?: string[];
  modelCodes?: string[];
}

export function createRepository(db: Database) {
  // Reference Tables
  async function getOrCreateReferenceTable(code: number, month: number, year: number) {
    const [existing] = await db
      .select()
      .from(referenceTables)
      .where(eq(referenceTables.code, code));

    if (existing) return existing;

    const [inserted] = await db.insert(referenceTables).values({ code, month, year }).returning();

    return inserted;
  }

  async function markReferenceCrawled(code: number, complete: boolean) {
    await db
      .update(referenceTables)
      .set({ crawledAt: complete ? new Date() : null })
      .where(eq(referenceTables.code, code));
  }

  function selectedModels(scope: CrawlScope) {
    return db
      .select({ id: models.id })
      .from(models)
      .innerJoin(brands, eq(models.brandId, brands.id))
      .where(
        and(
          scope.brandCodes ? inArray(brands.fipeCode, scope.brandCodes) : undefined,
          scope.modelCodes ? inArray(models.fipeCode, scope.modelCodes) : undefined,
        ),
      );
  }

  async function clearCrawlStatus(referenceId: number, scope: CrawlScope) {
    const modelIds = selectedModels(scope);
    const yearIds = db
      .select({ id: modelYears.id })
      .from(modelYears)
      .where(inArray(modelYears.modelId, modelIds));
    await db.transaction(async (tx) => {
      await tx
        .update(referenceModelYears)
        .set({ priceCrawledAt: null })
        .where(
          and(
            eq(referenceModelYears.referenceTableId, referenceId),
            inArray(referenceModelYears.modelYearId, yearIds),
          ),
        );
      await tx
        .update(referenceModels)
        .set({ yearsCrawledAt: null })
        .where(
          and(
            eq(referenceModels.referenceTableId, referenceId),
            inArray(referenceModels.modelId, modelIds),
          ),
        );
      if (!scope.modelCodes) {
        const brandIds = db
          .select({ id: brands.id })
          .from(brands)
          .where(scope.brandCodes ? inArray(brands.fipeCode, scope.brandCodes) : undefined);
        await tx
          .update(referenceBrands)
          .set({ modelsCrawledAt: null })
          .where(
            and(
              eq(referenceBrands.referenceTableId, referenceId),
              inArray(referenceBrands.brandId, brandIds),
            ),
          );
      }
    });
  }

  // Brands
  async function getOrCreateBrand(fipeCode: string, name: string) {
    const [existing] = await db.select().from(brands).where(eq(brands.fipeCode, fipeCode));

    if (existing) return existing;

    const [inserted] = await db.insert(brands).values({ fipeCode, name }).returning();

    return inserted;
  }

  // Models
  async function getOrCreateModel(brandId: number, fipeCode: string, name: string) {
    const [existing] = await db
      .select()
      .from(models)
      .where(and(eq(models.brandId, brandId), eq(models.fipeCode, fipeCode)));

    if (existing) return { model: existing, isNew: false };

    const [inserted] = await db.insert(models).values({ brandId, fipeCode, name }).returning();

    return { model: inserted, isNew: true };
  }

  // Model Years
  async function getOrCreateModelYear(
    modelId: number,
    year: number,
    fuelCode: number,
    fuelName: string,
  ) {
    const [existing] = await db
      .select()
      .from(modelYears)
      .where(
        and(
          eq(modelYears.modelId, modelId),
          eq(modelYears.year, year),
          eq(modelYears.fuelCode, fuelCode),
        ),
      );

    if (existing) return existing;

    const [inserted] = await db
      .insert(modelYears)
      .values({ modelId, year, fuelCode, fuelName })
      .returning();

    return inserted;
  }

  // Prices
  async function upsertPrice(
    modelYearId: number,
    referenceTableId: number,
    fipeCode: string,
    priceBrl: string,
  ) {
    await db
      .insert(prices)
      .values({ modelYearId, referenceTableId, fipeCode, priceBrl })
      .onConflictDoUpdate({
        target: [prices.modelYearId, prices.referenceTableId],
        set: { fipeCode, priceBrl, crawledAt: new Date() },
      });
  }

  // Stats
  async function getStats() {
    const [brandsCount] = await db.select({ count: count() }).from(brands);
    const [modelsCount] = await db.select({ count: count() }).from(models);
    const [pricesCount] = await db.select({ count: count() }).from(prices);
    const [refsCount] = await db.select({ count: count() }).from(referenceTables);

    return {
      brands: brandsCount?.count ?? 0,
      models: modelsCount?.count ?? 0,
      prices: pricesCount?.count ?? 0,
      references: refsCount?.count ?? 0,
    };
  }

  async function getReferenceCrawlProgress(code: number) {
    const [ref] = await db.select().from(referenceTables).where(eq(referenceTables.code, code));

    if (!ref) return null;

    const [brandCounts] = await db
      .select({
        total: count(),
        pending:
          sql<number>`count(*) filter (where ${referenceBrands.modelsCrawledAt} is null)`.mapWith(
            Number,
          ),
      })
      .from(referenceBrands)
      .where(eq(referenceBrands.referenceTableId, ref.id));
    const [modelCounts] = await db
      .select({
        total: count(),
        pending:
          sql<number>`count(*) filter (where ${referenceModels.yearsCrawledAt} is null)`.mapWith(
            Number,
          ),
      })
      .from(referenceModels)
      .where(eq(referenceModels.referenceTableId, ref.id));
    const [yearCounts] = await db
      .select({
        total: count(),
        pending:
          sql<number>`count(*) filter (where ${referenceModelYears.priceCrawledAt} is null)`.mapWith(
            Number,
          ),
      })
      .from(referenceModelYears)
      .where(eq(referenceModelYears.referenceTableId, ref.id));
    const [priceCounts] = await db
      .select({ total: count() })
      .from(prices)
      .where(eq(prices.referenceTableId, ref.id));
    return {
      code: ref.code,
      month: ref.month,
      year: ref.year,
      completedAt: ref.crawledAt,
      brands: brandCounts,
      models: modelCounts,
      modelYears: yearCounts,
      prices: priceCounts.total,
    };
  }

  // Segment Classification
  async function getModelsWithoutSegment() {
    return db
      .select({
        id: models.id,
        brandName: brands.name,
        modelName: models.name,
      })
      .from(models)
      .innerJoin(brands, eq(models.brandId, brands.id))
      .where(isNull(models.segment));
  }

  async function updateModelSegment(modelId: number, segment: Segment, source: 'ai' | 'manual') {
    await db.update(models).set({ segment, segmentSource: source }).where(eq(models.id, modelId));
  }

  // Reference Brands (crawl status tracking)
  async function getOrCreateReferenceBrand(referenceTableId: number, brandId: number) {
    const [existing] = await db
      .select()
      .from(referenceBrands)
      .where(
        and(
          eq(referenceBrands.referenceTableId, referenceTableId),
          eq(referenceBrands.brandId, brandId),
        ),
      );

    if (existing) return existing;

    const [inserted] = await db
      .insert(referenceBrands)
      .values({ referenceTableId, brandId })
      .returning();

    return inserted;
  }

  async function getUncrawledReferenceBrands(referenceTableId: number, scope: CrawlScope) {
    return db
      .select({
        id: referenceBrands.id,
        brandId: referenceBrands.brandId,
        fipeCode: brands.fipeCode,
        name: brands.name,
      })
      .from(referenceBrands)
      .innerJoin(brands, eq(referenceBrands.brandId, brands.id))
      .where(
        and(
          eq(referenceBrands.referenceTableId, referenceTableId),
          scope.modelCodes ? undefined : isNull(referenceBrands.modelsCrawledAt),
          scope.brandCodes ? inArray(brands.fipeCode, scope.brandCodes) : undefined,
        ),
      );
  }

  async function markReferenceBrandModelsCrawled(referenceBrandId: number) {
    await db
      .update(referenceBrands)
      .set({ modelsCrawledAt: new Date() })
      .where(eq(referenceBrands.id, referenceBrandId));
  }

  // Reference Models (crawl status tracking)
  async function getOrCreateReferenceModel(referenceTableId: number, modelId: number) {
    const [existing] = await db
      .select()
      .from(referenceModels)
      .where(
        and(
          eq(referenceModels.referenceTableId, referenceTableId),
          eq(referenceModels.modelId, modelId),
        ),
      );

    if (existing) return existing;

    const [inserted] = await db
      .insert(referenceModels)
      .values({ referenceTableId, modelId })
      .returning();

    return inserted;
  }

  async function getUncrawledReferenceModels(referenceTableId: number, scope: CrawlScope) {
    return db
      .select({
        id: referenceModels.id,
        modelId: referenceModels.modelId,
        brandId: models.brandId,
        fipeCode: models.fipeCode,
        name: models.name,
        brandFipeCode: brands.fipeCode,
        brandName: brands.name,
      })
      .from(referenceModels)
      .innerJoin(models, eq(referenceModels.modelId, models.id))
      .innerJoin(brands, eq(models.brandId, brands.id))
      .where(
        and(
          eq(referenceModels.referenceTableId, referenceTableId),
          isNull(referenceModels.yearsCrawledAt),
          scope.brandCodes ? inArray(brands.fipeCode, scope.brandCodes) : undefined,
          scope.modelCodes ? inArray(models.fipeCode, scope.modelCodes) : undefined,
        ),
      );
  }

  async function markReferenceModelYearsCrawled(referenceModelId: number) {
    await db
      .update(referenceModels)
      .set({ yearsCrawledAt: new Date() })
      .where(eq(referenceModels.id, referenceModelId));
  }

  // Reference Model Years (crawl status tracking)
  async function getOrCreateReferenceModelYear(referenceTableId: number, modelYearId: number) {
    const [existing] = await db
      .select()
      .from(referenceModelYears)
      .where(
        and(
          eq(referenceModelYears.referenceTableId, referenceTableId),
          eq(referenceModelYears.modelYearId, modelYearId),
        ),
      );

    if (existing) return existing;

    const [inserted] = await db
      .insert(referenceModelYears)
      .values({ referenceTableId, modelYearId })
      .returning();

    return inserted;
  }

  async function getUncrawledReferenceModelYears(referenceTableId: number, scope: CrawlScope) {
    return db
      .select({
        id: referenceModelYears.id,
        modelYearId: referenceModelYears.modelYearId,
        year: modelYears.year,
        fuelCode: modelYears.fuelCode,
        modelId: modelYears.modelId,
        modelFipeCode: models.fipeCode,
        brandFipeCode: brands.fipeCode,
      })
      .from(referenceModelYears)
      .innerJoin(modelYears, eq(referenceModelYears.modelYearId, modelYears.id))
      .innerJoin(models, eq(modelYears.modelId, models.id))
      .innerJoin(brands, eq(models.brandId, brands.id))
      .where(
        and(
          eq(referenceModelYears.referenceTableId, referenceTableId),
          isNull(referenceModelYears.priceCrawledAt),
          scope.brandCodes ? inArray(brands.fipeCode, scope.brandCodes) : undefined,
          scope.modelCodes ? inArray(models.fipeCode, scope.modelCodes) : undefined,
        ),
      );
  }

  async function markReferenceModelYearPriceCrawled(referenceModelYearId: number) {
    await db
      .update(referenceModelYears)
      .set({ priceCrawledAt: new Date() })
      .where(eq(referenceModelYears.id, referenceModelYearId));
  }

  async function refreshLatestPrices() {
    await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY latest_prices`);
  }

  return {
    getOrCreateReferenceTable,
    markReferenceCrawled,
    clearCrawlStatus,
    getOrCreateBrand,
    getOrCreateModel,
    getOrCreateModelYear,
    upsertPrice,
    getStats,
    getReferenceCrawlProgress,
    getModelsWithoutSegment,
    updateModelSegment,
    getOrCreateReferenceBrand,
    getUncrawledReferenceBrands,
    markReferenceBrandModelsCrawled,
    getOrCreateReferenceModel,
    getUncrawledReferenceModels,
    markReferenceModelYearsCrawled,
    getOrCreateReferenceModelYear,
    getUncrawledReferenceModelYears,
    markReferenceModelYearPriceCrawled,
    refreshLatestPrices,
  };
}
export type Repository = ReturnType<typeof createRepository>;

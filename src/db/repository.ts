import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Segment } from "../classifier/segments.js";
import type { Database } from "./connection.js";
import {
  brands,
  modelYears,
  models,
  prices,
  referenceBrands,
  referenceModelYears,
  referenceModels,
  referenceTables,
} from "./schema.js";

export interface CrawlScope {
  brandCodes?: string[];
  modelCodes?: string[];
}

export function createRepository(db: Database) {
  async function markReferencePublished(code: number) {
    await db
      .update(referenceTables)
      .set({
        publishedAt: sql`NOW()`,
        latestPricesRefreshedAt: null,
        backupCompletedAt: null,
      })
      .where(eq(referenceTables.code, code));
  }
  async function getReferenceByCode(code: number) {
    const [reference] = await db
      .select()
      .from(referenceTables)
      .where(eq(referenceTables.code, code))
      .limit(1);

    return reference;
  }
  async function getLatestPublishedReference() {
    const [reference] = await db
      .select()
      .from(referenceTables)
      .where(isNotNull(referenceTables.publishedAt))
      .orderBy(desc(referenceTables.year), desc(referenceTables.month), desc(referenceTables.code))
      .limit(1);

    return reference;
  }
  async function getReferencePriceCount(referenceTableId: number): Promise<number> {
    const [result] = await db
      .select({ count: count() })
      .from(prices)
      .where(eq(prices.referenceTableId, referenceTableId));

    return result?.count ?? 0;
  }
  async function getPublishedReferencesPendingLatestPricesRefreshCount(): Promise<number> {
    const [result] = await db
      .select({ count: count() })
      .from(referenceTables)
      .where(
        and(
          isNotNull(referenceTables.publishedAt),
          isNull(referenceTables.latestPricesRefreshedAt),
        ),
      );

    return result?.count ?? 0;
  }
  async function markPublishedReferencesLatestPricesRefreshed() {
    await db
      .update(referenceTables)
      .set({ latestPricesRefreshedAt: sql`NOW()` })
      .where(
        and(
          isNotNull(referenceTables.publishedAt),
          isNull(referenceTables.latestPricesRefreshedAt),
        ),
      );
  }
  async function getPublishedReferencesPendingBackupCount(): Promise<number> {
    const [result] = await db
      .select({ count: count() })
      .from(referenceTables)
      .where(
        and(isNotNull(referenceTables.publishedAt), isNull(referenceTables.backupCompletedAt)),
      );

    return result?.count ?? 0;
  }
  async function markPublishedReferencesBackedUp() {
    await db
      .update(referenceTables)
      .set({ backupCompletedAt: sql`NOW()` })
      .where(
        and(isNotNull(referenceTables.publishedAt), isNull(referenceTables.backupCompletedAt)),
      );
  }
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
    const ref = await getReferenceByCode(code);

    if (!ref) return null;

    const [[brandCounts], [modelCounts], [yearCounts], [priceCounts]] = await Promise.all([
      db
        .select({
          total: count(),
          pending:
            sql<number>`count(*) filter (where ${referenceBrands.modelsCrawledAt} is null)`.mapWith(
              Number,
            ),
        })
        .from(referenceBrands)
        .where(eq(referenceBrands.referenceTableId, ref.id)),
      db
        .select({
          total: count(),
          pending:
            sql<number>`count(*) filter (where ${referenceModels.yearsCrawledAt} is null)`.mapWith(
              Number,
            ),
        })
        .from(referenceModels)
        .where(eq(referenceModels.referenceTableId, ref.id)),
      db
        .select({
          total: count(),
          pending:
            sql<number>`count(*) filter (where ${referenceModelYears.priceCrawledAt} is null)`.mapWith(
              Number,
            ),
        })
        .from(referenceModelYears)
        .where(eq(referenceModelYears.referenceTableId, ref.id)),
      db.select({ total: count() }).from(prices).where(eq(prices.referenceTableId, ref.id)),
    ]);
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

  async function updateModelSegment(modelId: number, segment: Segment, source: "ai" | "manual") {
    await db.update(models).set({ segment, segmentSource: source }).where(eq(models.id, modelId));
  }

  // Reference Brands (crawl status tracking)
  async function ensureReferenceBrand(referenceTableId: number, brandId: number) {
    await db
      .insert(referenceBrands)
      .values({ referenceTableId, brandId })
      .onConflictDoNothing({ target: [referenceBrands.referenceTableId, referenceBrands.brandId] });
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
  async function ensureReferenceModel(referenceTableId: number, modelId: number) {
    await db
      .insert(referenceModels)
      .values({ referenceTableId, modelId })
      .onConflictDoNothing({ target: [referenceModels.referenceTableId, referenceModels.modelId] });
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
  async function ensureReferenceModelYear(referenceTableId: number, modelYearId: number) {
    await db
      .insert(referenceModelYears)
      .values({ referenceTableId, modelYearId })
      .onConflictDoNothing({
        target: [referenceModelYears.referenceTableId, referenceModelYears.modelYearId],
      });
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
    markReferencePublished,
    getReferenceByCode,
    getLatestPublishedReference,
    getReferencePriceCount,
    getPublishedReferencesPendingLatestPricesRefreshCount,
    markPublishedReferencesLatestPricesRefreshed,
    getPublishedReferencesPendingBackupCount,
    markPublishedReferencesBackedUp,

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
    ensureReferenceBrand,
    getUncrawledReferenceBrands,
    markReferenceBrandModelsCrawled,
    ensureReferenceModel,
    getUncrawledReferenceModels,
    markReferenceModelYearsCrawled,
    ensureReferenceModelYear,
    getUncrawledReferenceModelYears,
    markReferenceModelYearPriceCrawled,
    refreshLatestPrices,
  };
}
export type Repository = ReturnType<typeof createRepository>;

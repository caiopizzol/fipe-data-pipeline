import { and, count, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from './connection.js';
import {
  type Segment,
  brands,
  modelYears,
  models,
  prices,
  referenceBrands,
  referenceModelYears,
  referenceModels,
  referenceTables,
} from './schema.js';

export interface CrawlBacklog {
  uncrawledBrands: number;
  uncrawledModels: number;
  uncrawledModelYears: number;
}

// Reference Tables
export async function upsertReferenceTable(code: number, month: number, year: number) {
  const [existing] = await db.select().from(referenceTables).where(eq(referenceTables.code, code));

  if (existing) return existing;

  const [inserted] = await db.insert(referenceTables).values({ code, month, year }).returning();

  return inserted;
}

export async function markReferenceCrawled(code: number) {
  await db
    .update(referenceTables)
    .set({ crawledAt: new Date() })
    .where(eq(referenceTables.code, code));
}

export async function markReferencePublished(code: number) {
  await db
    .update(referenceTables)
    .set({
      publishedAt: sql`NOW()`,
      latestPricesRefreshedAt: null,
      backupCompletedAt: null,
    })
    .where(eq(referenceTables.code, code));
}

export async function getReferenceByCode(code: number) {
  const [reference] = await db
    .select()
    .from(referenceTables)
    .where(eq(referenceTables.code, code))
    .limit(1);

  return reference;
}

export async function getLatestPublishedReference() {
  const [reference] = await db
    .select()
    .from(referenceTables)
    .where(isNotNull(referenceTables.publishedAt))
    .orderBy(desc(referenceTables.year), desc(referenceTables.month), desc(referenceTables.code))
    .limit(1);

  return reference;
}

export async function clearCrawlStatus(referenceId: number) {
  await db.delete(referenceModelYears).where(eq(referenceModelYears.referenceTableId, referenceId));
  await db.delete(referenceModels).where(eq(referenceModels.referenceTableId, referenceId));
  await db.delete(referenceBrands).where(eq(referenceBrands.referenceTableId, referenceId));
}

// Brands
export async function upsertBrand(fipeCode: string, name: string) {
  const [existing] = await db.select().from(brands).where(eq(brands.fipeCode, fipeCode));

  if (existing) return existing;

  const [inserted] = await db.insert(brands).values({ fipeCode, name }).returning();

  return inserted;
}

// Models
export async function upsertModel(brandId: number, fipeCode: string, name: string) {
  const [existing] = await db
    .select()
    .from(models)
    .where(and(eq(models.brandId, brandId), eq(models.fipeCode, fipeCode)));

  if (existing) return { model: existing, isNew: false };

  const [inserted] = await db.insert(models).values({ brandId, fipeCode, name }).returning();

  return { model: inserted, isNew: true };
}

// Model Years
export async function upsertModelYear(
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
export async function upsertPrice(
  modelYearId: number,
  referenceTableId: number,
  fipeCode: string,
  priceBrl: string,
) {
  const [existing] = await db
    .select()
    .from(prices)
    .where(and(eq(prices.modelYearId, modelYearId), eq(prices.referenceTableId, referenceTableId)));

  if (existing) {
    // Update if price changed
    if (existing.priceBrl !== priceBrl) {
      await db
        .update(prices)
        .set({ priceBrl, crawledAt: new Date() })
        .where(eq(prices.id, existing.id));
    }
    return existing;
  }

  const [inserted] = await db
    .insert(prices)
    .values({ modelYearId, referenceTableId, fipeCode, priceBrl })
    .returning();

  return inserted;
}

// Stats
export async function getStats() {
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

export async function getCrawlBacklog(referenceTableId: number): Promise<CrawlBacklog> {
  const [brandsBacklog, modelsBacklog, modelYearsBacklog] = await Promise.all([
    db
      .select({ count: count() })
      .from(referenceBrands)
      .where(
        and(
          eq(referenceBrands.referenceTableId, referenceTableId),
          isNull(referenceBrands.modelsCrawledAt),
        ),
      ),
    db
      .select({ count: count() })
      .from(referenceModels)
      .where(
        and(
          eq(referenceModels.referenceTableId, referenceTableId),
          isNull(referenceModels.yearsCrawledAt),
        ),
      ),
    db
      .select({ count: count() })
      .from(referenceModelYears)
      .where(
        and(
          eq(referenceModelYears.referenceTableId, referenceTableId),
          isNull(referenceModelYears.priceCrawledAt),
        ),
      ),
  ]);

  return {
    uncrawledBrands: brandsBacklog[0]?.count ?? 0,
    uncrawledModels: modelsBacklog[0]?.count ?? 0,
    uncrawledModelYears: modelYearsBacklog[0]?.count ?? 0,
  };
}

export async function getReferencePriceCount(referenceTableId: number): Promise<number> {
  const [result] = await db
    .select({ count: count() })
    .from(prices)
    .where(eq(prices.referenceTableId, referenceTableId));

  return result?.count ?? 0;
}

export async function getPublishedReferencesPendingLatestPricesRefreshCount(): Promise<number> {
  const [result] = await db
    .select({ count: count() })
    .from(referenceTables)
    .where(
      and(isNotNull(referenceTables.publishedAt), isNull(referenceTables.latestPricesRefreshedAt)),
    );

  return result?.count ?? 0;
}

export async function markPublishedReferencesLatestPricesRefreshed() {
  await db
    .update(referenceTables)
    .set({ latestPricesRefreshedAt: sql`NOW()` })
    .where(
      and(isNotNull(referenceTables.publishedAt), isNull(referenceTables.latestPricesRefreshedAt)),
    );
}

export async function getPublishedReferencesPendingBackupCount(): Promise<number> {
  const [result] = await db
    .select({ count: count() })
    .from(referenceTables)
    .where(and(isNotNull(referenceTables.publishedAt), isNull(referenceTables.backupCompletedAt)));

  return result?.count ?? 0;
}

export async function markPublishedReferencesBackedUp() {
  await db
    .update(referenceTables)
    .set({ backupCompletedAt: sql`NOW()` })
    .where(and(isNotNull(referenceTables.publishedAt), isNull(referenceTables.backupCompletedAt)));
}

// Segment Classification
export async function getModelsWithoutSegment() {
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

export async function updateModelSegment(
  modelId: number,
  segment: Segment,
  source: 'ai' | 'manual',
) {
  await db.update(models).set({ segment, segmentSource: source }).where(eq(models.id, modelId));
}

export async function getModelById(modelId: number) {
  const [model] = await db
    .select({
      id: models.id,
      segment: models.segment,
      brandName: brands.name,
      modelName: models.name,
    })
    .from(models)
    .innerJoin(brands, eq(models.brandId, brands.id))
    .where(eq(models.id, modelId));

  return model;
}

// Reference Brands (crawl status tracking)
export async function upsertReferenceBrand(referenceTableId: number, brandId: number) {
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

export async function getUncrawledReferenceBrands(referenceTableId: number) {
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
        isNull(referenceBrands.modelsCrawledAt),
      ),
    );
}

export async function markReferenceBrandModelsCrawled(referenceBrandId: number) {
  await db
    .update(referenceBrands)
    .set({ modelsCrawledAt: new Date() })
    .where(eq(referenceBrands.id, referenceBrandId));
}

// Reference Models (crawl status tracking)
export async function upsertReferenceModel(referenceTableId: number, modelId: number) {
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

export async function getUncrawledReferenceModels(referenceTableId: number) {
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
      ),
    );
}

export async function markReferenceModelYearsCrawled(referenceModelId: number) {
  await db
    .update(referenceModels)
    .set({ yearsCrawledAt: new Date() })
    .where(eq(referenceModels.id, referenceModelId));
}

// Reference Model Years (crawl status tracking)
export async function upsertReferenceModelYear(referenceTableId: number, modelYearId: number) {
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

export async function getUncrawledReferenceModelYears(referenceTableId: number) {
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
      ),
    );
}

export async function markReferenceModelYearPriceCrawled(referenceModelYearId: number) {
  await db
    .update(referenceModelYears)
    .set({ priceCrawledAt: new Date() })
    .where(eq(referenceModelYears.id, referenceModelYearId));
}

export async function refreshLatestPrices() {
  await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY latest_prices`);
}

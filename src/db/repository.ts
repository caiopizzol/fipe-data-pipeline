import { eq, and, isNull } from "drizzle-orm";
import { db } from "./connection.js";
import {
  referenceTables,
  brands,
  models,
  modelYears,
  prices,
  type Segment,
} from "./schema.js";

// Reference Tables
export async function upsertReferenceTable(code: number, month: number, year: number) {
  const [existing] = await db
    .select()
    .from(referenceTables)
    .where(eq(referenceTables.code, code));

  if (existing) return existing;

  const [inserted] = await db
    .insert(referenceTables)
    .values({ code, month, year })
    .returning();

  return inserted;
}

export async function markReferenceCrawled(code: number) {
  await db
    .update(referenceTables)
    .set({ crawledAt: new Date() })
    .where(eq(referenceTables.code, code));
}

export async function getCrawledReferences(): Promise<number[]> {
  const rows = await db
    .select({ code: referenceTables.code })
    .from(referenceTables)
    .where(eq(referenceTables.crawledAt, referenceTables.crawledAt)); // not null

  return rows.map((r) => r.code);
}

// Brands
export async function upsertBrand(fipeCode: string, name: string) {
  const [existing] = await db
    .select()
    .from(brands)
    .where(eq(brands.fipeCode, fipeCode));

  if (existing) return existing;

  const [inserted] = await db
    .insert(brands)
    .values({ fipeCode, name })
    .returning();

  return inserted;
}

// Models
export async function upsertModel(brandId: number, fipeCode: string, name: string) {
  const [existing] = await db
    .select()
    .from(models)
    .where(and(eq(models.brandId, brandId), eq(models.fipeCode, fipeCode)));

  if (existing) return { model: existing, isNew: false };

  const [inserted] = await db
    .insert(models)
    .values({ brandId, fipeCode, name })
    .returning();

  return { model: inserted, isNew: true };
}

// Model Years
export async function upsertModelYear(
  modelId: number,
  year: number,
  fuelCode: number,
  fuelName: string
) {
  const [existing] = await db
    .select()
    .from(modelYears)
    .where(
      and(
        eq(modelYears.modelId, modelId),
        eq(modelYears.year, year),
        eq(modelYears.fuelCode, fuelCode)
      )
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
  priceBrl: string
) {
  const [existing] = await db
    .select()
    .from(prices)
    .where(
      and(
        eq(prices.modelYearId, modelYearId),
        eq(prices.referenceTableId, referenceTableId)
      )
    );

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
  const [brandsCount] = await db.select({ count: brands.id }).from(brands);
  const [modelsCount] = await db.select({ count: models.id }).from(models);
  const [pricesCount] = await db.select({ count: prices.id }).from(prices);
  const [refsCount] = await db.select({ count: referenceTables.id }).from(referenceTables);

  return {
    brands: brandsCount?.count ?? 0,
    models: modelsCount?.count ?? 0,
    prices: pricesCount?.count ?? 0,
    references: refsCount?.count ?? 0,
  };
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
  source: "ai" | "manual"
) {
  await db
    .update(models)
    .set({ segment, segmentSource: source })
    .where(eq(models.id, modelId));
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

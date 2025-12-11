import {
  pgTable,
  serial,
  integer,
  varchar,
  decimal,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';

export const referenceTables = pgTable(
  'reference_tables',
  {
    id: serial('id').primaryKey(),
    code: integer('code').unique().notNull(),
    month: integer('month').notNull(),
    year: integer('year').notNull(),
    crawledAt: timestamp('crawled_at'),
  },
  (table) => [index('idx_reference_year_month').on(table.year, table.month)],
);

export const brands = pgTable(
  'brands',
  {
    id: serial('id').primaryKey(),
    fipeCode: varchar('fipe_code', { length: 10 }).unique().notNull(),
    name: varchar('name', { length: 100 }).notNull(),
  },
  (table) => [index('idx_brands_name').on(table.name)],
);

export const SEGMENTS = [
  'Buggy',
  'Caminhão Leve',
  'Conversível',
  'Coupé',
  'Hatch',
  'Perua',
  'Pick-up',
  'Sedã',
  'SUV',
  'Van/Utilitário',
] as const;

export type Segment = (typeof SEGMENTS)[number];

export const models = pgTable(
  'models',
  {
    id: serial('id').primaryKey(),
    brandId: integer('brand_id')
      .references(() => brands.id)
      .notNull(),
    fipeCode: varchar('fipe_code', { length: 20 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    segment: varchar('segment', { length: 20 }),
    segmentSource: varchar('segment_source', { length: 10 }),
  },
  (table) => [
    unique().on(table.brandId, table.fipeCode),
    index('idx_models_brand_id').on(table.brandId),
    index('idx_models_segment').on(table.segment),
  ],
);

export const modelYears = pgTable(
  'model_years',
  {
    id: serial('id').primaryKey(),
    modelId: integer('model_id')
      .references(() => models.id)
      .notNull(),
    year: integer('year').notNull(),
    fuelCode: integer('fuel_code').notNull(),
    fuelName: varchar('fuel_name', { length: 50 }),
  },
  (table) => [
    unique().on(table.modelId, table.year, table.fuelCode),
    index('idx_model_years_model_id').on(table.modelId),
    index('idx_model_years_year').on(table.year),
  ],
);

export const prices = pgTable(
  'prices',
  {
    id: serial('id').primaryKey(),
    modelYearId: integer('model_year_id')
      .references(() => modelYears.id)
      .notNull(),
    referenceTableId: integer('reference_table_id')
      .references(() => referenceTables.id)
      .notNull(),
    fipeCode: varchar('fipe_code', { length: 20 }).notNull(),
    priceBrl: decimal('price_brl', { precision: 12, scale: 2 }).notNull(),
    crawledAt: timestamp('crawled_at').defaultNow(),
  },
  (table) => [
    unique().on(table.modelYearId, table.referenceTableId),
    index('idx_prices_reference').on(table.referenceTableId),
    index('idx_prices_fipe_code').on(table.fipeCode),
    index('idx_prices_model_year_id').on(table.modelYearId),
  ],
);

// Crawl status tracking tables (per reference)
export const referenceBrands = pgTable(
  'reference_brands',
  {
    id: serial('id').primaryKey(),
    referenceTableId: integer('reference_table_id')
      .references(() => referenceTables.id)
      .notNull(),
    brandId: integer('brand_id')
      .references(() => brands.id)
      .notNull(),
    modelsCrawledAt: timestamp('models_crawled_at'),
  },
  (table) => [
    unique().on(table.referenceTableId, table.brandId),
    index('idx_reference_brands_ref').on(table.referenceTableId),
    index('idx_reference_brands_brand').on(table.brandId),
  ],
);

export const referenceModels = pgTable(
  'reference_models',
  {
    id: serial('id').primaryKey(),
    referenceTableId: integer('reference_table_id')
      .references(() => referenceTables.id)
      .notNull(),
    modelId: integer('model_id')
      .references(() => models.id)
      .notNull(),
    yearsCrawledAt: timestamp('years_crawled_at'),
  },
  (table) => [
    unique().on(table.referenceTableId, table.modelId),
    index('idx_reference_models_ref').on(table.referenceTableId),
    index('idx_reference_models_model').on(table.modelId),
  ],
);

export const referenceModelYears = pgTable(
  'reference_model_years',
  {
    id: serial('id').primaryKey(),
    referenceTableId: integer('reference_table_id')
      .references(() => referenceTables.id)
      .notNull(),
    modelYearId: integer('model_year_id')
      .references(() => modelYears.id)
      .notNull(),
    priceCrawledAt: timestamp('price_crawled_at'),
  },
  (table) => [
    unique().on(table.referenceTableId, table.modelYearId),
    index('idx_reference_model_years_ref').on(table.referenceTableId),
    index('idx_reference_model_years_my').on(table.modelYearId),
  ],
);

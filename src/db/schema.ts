import {
  pgTable,
  serial,
  integer,
  varchar,
  decimal,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";

export const referenceTables = pgTable("reference_tables", {
  id: serial("id").primaryKey(),
  code: integer("code").unique().notNull(),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  crawledAt: timestamp("crawled_at"),
});

export const brands = pgTable("brands", {
  id: serial("id").primaryKey(),
  fipeCode: varchar("fipe_code", { length: 10 }).unique().notNull(),
  name: varchar("name", { length: 100 }).notNull(),
});

export const SEGMENTS = [
  "Buggy",
  "Caminhão Leve",
  "Conversível",
  "Coupé",
  "Hatch",
  "Perua",
  "Pick-up",
  "Sedã",
  "SUV",
  "Van/Utilitário",
] as const;

export type Segment = (typeof SEGMENTS)[number];

export const models = pgTable(
  "models",
  {
    id: serial("id").primaryKey(),
    brandId: integer("brand_id")
      .references(() => brands.id)
      .notNull(),
    fipeCode: varchar("fipe_code", { length: 20 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    segment: varchar("segment", { length: 20 }),
    segmentSource: varchar("segment_source", { length: 10 }),
  },
  (table) => [unique().on(table.brandId, table.fipeCode)]
);

export const modelYears = pgTable(
  "model_years",
  {
    id: serial("id").primaryKey(),
    modelId: integer("model_id")
      .references(() => models.id)
      .notNull(),
    year: integer("year").notNull(),
    fuelCode: integer("fuel_code").notNull(),
    fuelName: varchar("fuel_name", { length: 50 }),
  },
  (table) => [unique().on(table.modelId, table.year, table.fuelCode)]
);

export const prices = pgTable(
  "prices",
  {
    id: serial("id").primaryKey(),
    modelYearId: integer("model_year_id")
      .references(() => modelYears.id)
      .notNull(),
    referenceTableId: integer("reference_table_id")
      .references(() => referenceTables.id)
      .notNull(),
    fipeCode: varchar("fipe_code", { length: 20 }).notNull(),
    priceBrl: decimal("price_brl", { precision: 12, scale: 2 }).notNull(),
    crawledAt: timestamp("crawled_at").defaultNow(),
  },
  (table) => [
    unique().on(table.modelYearId, table.referenceTableId),
    index("idx_prices_reference").on(table.referenceTableId),
    index("idx_prices_fipe_code").on(table.fipeCode),
  ]
);

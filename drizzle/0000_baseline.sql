-- Baseline supports the existing eight-table schema as well as a fresh database.
CREATE TABLE IF NOT EXISTS "reference_tables" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" integer NOT NULL,
	"month" integer NOT NULL,
	"year" integer NOT NULL,
	"crawled_at" timestamp,
	CONSTRAINT "reference_tables_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "brands" (
	"id" serial PRIMARY KEY NOT NULL,
	"fipe_code" varchar(10) NOT NULL,
	"name" varchar(100) NOT NULL,
	CONSTRAINT "brands_fipe_code_unique" UNIQUE("fipe_code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "models" (
	"id" serial PRIMARY KEY NOT NULL,
	"brand_id" integer NOT NULL,
	"fipe_code" varchar(20) NOT NULL,
	"name" varchar(200) NOT NULL,
	"segment" varchar(20),
	"segment_source" varchar(10),
	CONSTRAINT "models_brand_id_fipe_code_unique" UNIQUE("brand_id","fipe_code"),
	CONSTRAINT "models_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_years" (
	"id" serial PRIMARY KEY NOT NULL,
	"model_id" integer NOT NULL,
	"year" integer NOT NULL,
	"fuel_code" integer NOT NULL,
	"fuel_name" varchar(50),
	CONSTRAINT "model_years_model_id_year_fuel_code_unique" UNIQUE("model_id","year","fuel_code"),
	CONSTRAINT "model_years_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"model_year_id" integer NOT NULL,
	"reference_table_id" integer NOT NULL,
	"fipe_code" varchar(20) NOT NULL,
	"price_brl" numeric(12, 2) NOT NULL,
	"crawled_at" timestamp DEFAULT now(),
	CONSTRAINT "prices_model_year_id_reference_table_id_unique" UNIQUE("model_year_id","reference_table_id"),
	CONSTRAINT "prices_model_year_id_model_years_id_fk" FOREIGN KEY ("model_year_id") REFERENCES "public"."model_years"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "prices_reference_table_id_reference_tables_id_fk" FOREIGN KEY ("reference_table_id") REFERENCES "public"."reference_tables"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reference_brands" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference_table_id" integer NOT NULL,
	"brand_id" integer NOT NULL,
	"models_crawled_at" timestamp,
	CONSTRAINT "reference_brands_reference_table_id_brand_id_unique" UNIQUE("reference_table_id","brand_id"),
	CONSTRAINT "reference_brands_reference_table_id_reference_tables_id_fk" FOREIGN KEY ("reference_table_id") REFERENCES "public"."reference_tables"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "reference_brands_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reference_models" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference_table_id" integer NOT NULL,
	"model_id" integer NOT NULL,
	"years_crawled_at" timestamp,
	CONSTRAINT "reference_models_reference_table_id_model_id_unique" UNIQUE("reference_table_id","model_id"),
	CONSTRAINT "reference_models_reference_table_id_reference_tables_id_fk" FOREIGN KEY ("reference_table_id") REFERENCES "public"."reference_tables"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "reference_models_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reference_model_years" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference_table_id" integer NOT NULL,
	"model_year_id" integer NOT NULL,
	"price_crawled_at" timestamp,
	CONSTRAINT "reference_model_years_reference_table_id_model_year_id_unique" UNIQUE("reference_table_id","model_year_id"),
	CONSTRAINT "reference_model_years_reference_table_id_reference_tables_id_fk" FOREIGN KEY ("reference_table_id") REFERENCES "public"."reference_tables"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "reference_model_years_model_year_id_model_years_id_fk" FOREIGN KEY ("model_year_id") REFERENCES "public"."model_years"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_brands_name" ON "brands" USING btree ("name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_model_years_model_id" ON "model_years" USING btree ("model_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_model_years_year" ON "model_years" USING btree ("year");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_models_brand_id" ON "models" USING btree ("brand_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_models_segment" ON "models" USING btree ("segment");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_prices_reference" ON "prices" USING btree ("reference_table_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_prices_fipe_code" ON "prices" USING btree ("fipe_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_prices_model_year_id" ON "prices" USING btree ("model_year_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_reference_brands_ref" ON "reference_brands" USING btree ("reference_table_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_reference_brands_brand" ON "reference_brands" USING btree ("brand_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_reference_model_years_ref" ON "reference_model_years" USING btree ("reference_table_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_reference_model_years_my" ON "reference_model_years" USING btree ("model_year_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_reference_models_ref" ON "reference_models" USING btree ("reference_table_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_reference_models_model" ON "reference_models" USING btree ("model_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_reference_year_month" ON "reference_tables" USING btree ("year","month");

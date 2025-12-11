CREATE TABLE IF NOT EXISTS reference_tables (
  id SERIAL PRIMARY KEY,
  code INTEGER UNIQUE NOT NULL,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  crawled_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS brands (
  id SERIAL PRIMARY KEY,
  fipe_code VARCHAR(10) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS models (
  id SERIAL PRIMARY KEY,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  fipe_code VARCHAR(20) NOT NULL,
  name VARCHAR(200) NOT NULL,
  segment VARCHAR(20),
  segment_source VARCHAR(10),
  UNIQUE(brand_id, fipe_code)
);

CREATE TABLE IF NOT EXISTS model_years (
  id SERIAL PRIMARY KEY,
  model_id INTEGER NOT NULL REFERENCES models(id),
  year INTEGER NOT NULL,
  fuel_code INTEGER NOT NULL,
  fuel_name VARCHAR(50),
  UNIQUE(model_id, year, fuel_code)
);

CREATE TABLE IF NOT EXISTS prices (
  id SERIAL PRIMARY KEY,
  model_year_id INTEGER NOT NULL REFERENCES model_years(id),
  reference_table_id INTEGER NOT NULL REFERENCES reference_tables(id),
  fipe_code VARCHAR(20) NOT NULL,
  price_brl DECIMAL(12, 2) NOT NULL,
  crawled_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(model_year_id, reference_table_id)
);

-- Existing indexes
CREATE INDEX IF NOT EXISTS idx_prices_reference ON prices(reference_table_id);
CREATE INDEX IF NOT EXISTS idx_prices_fipe_code ON prices(fipe_code);

-- Foreign key indexes (for JOINs)
CREATE INDEX IF NOT EXISTS idx_models_brand_id ON models(brand_id);
CREATE INDEX IF NOT EXISTS idx_model_years_model_id ON model_years(model_id);
CREATE INDEX IF NOT EXISTS idx_prices_model_year_id ON prices(model_year_id);

-- Filter indexes
CREATE INDEX IF NOT EXISTS idx_models_segment ON models(segment);
CREATE INDEX IF NOT EXISTS idx_reference_year_month ON reference_tables(year, month);
CREATE INDEX IF NOT EXISTS idx_model_years_year ON model_years(year);
CREATE INDEX IF NOT EXISTS idx_brands_name ON brands(name);

-- Crawl status tracking tables (per reference)
CREATE TABLE IF NOT EXISTS reference_brands (
  id SERIAL PRIMARY KEY,
  reference_table_id INTEGER NOT NULL REFERENCES reference_tables(id),
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  models_crawled_at TIMESTAMP,
  UNIQUE(reference_table_id, brand_id)
);

CREATE TABLE IF NOT EXISTS reference_models (
  id SERIAL PRIMARY KEY,
  reference_table_id INTEGER NOT NULL REFERENCES reference_tables(id),
  model_id INTEGER NOT NULL REFERENCES models(id),
  years_crawled_at TIMESTAMP,
  UNIQUE(reference_table_id, model_id)
);

CREATE TABLE IF NOT EXISTS reference_model_years (
  id SERIAL PRIMARY KEY,
  reference_table_id INTEGER NOT NULL REFERENCES reference_tables(id),
  model_year_id INTEGER NOT NULL REFERENCES model_years(id),
  price_crawled_at TIMESTAMP,
  UNIQUE(reference_table_id, model_year_id)
);

-- Crawl status indexes
CREATE INDEX IF NOT EXISTS idx_reference_brands_ref ON reference_brands(reference_table_id);
CREATE INDEX IF NOT EXISTS idx_reference_brands_brand ON reference_brands(brand_id);
CREATE INDEX IF NOT EXISTS idx_reference_models_ref ON reference_models(reference_table_id);
CREATE INDEX IF NOT EXISTS idx_reference_models_model ON reference_models(model_id);
CREATE INDEX IF NOT EXISTS idx_reference_model_years_ref ON reference_model_years(reference_table_id);
CREATE INDEX IF NOT EXISTS idx_reference_model_years_my ON reference_model_years(model_year_id);

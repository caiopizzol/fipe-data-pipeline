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

CREATE INDEX IF NOT EXISTS idx_prices_reference ON prices(reference_table_id);
CREATE INDEX IF NOT EXISTS idx_prices_fipe_code ON prices(fipe_code);

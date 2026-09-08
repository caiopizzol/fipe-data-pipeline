-- Backfill only databases that predate publication. Preserve existing retry markers.
DO $migration$
DECLARE
  adopting_publication BOOLEAN;
BEGIN
  adopting_publication := NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reference_tables' AND column_name = 'published_at'
  );
  ALTER TABLE reference_tables ADD COLUMN IF NOT EXISTS published_at TIMESTAMP;
  ALTER TABLE reference_tables ADD COLUMN IF NOT EXISTS latest_prices_refreshed_at TIMESTAMP;
  ALTER TABLE reference_tables ADD COLUMN IF NOT EXISTS backup_completed_at TIMESTAMP;

  IF adopting_publication THEN
    UPDATE reference_tables rt
    SET published_at = COALESCE(rt.crawled_at, NOW())
    WHERE rt.published_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM prices p
        WHERE p.reference_table_id = rt.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM reference_brands rb
        WHERE rb.reference_table_id = rt.id
          AND rb.models_crawled_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM reference_models rm
        WHERE rm.reference_table_id = rt.id
          AND rm.years_crawled_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM reference_model_years rmy
        WHERE rmy.reference_table_id = rt.id
          AND rmy.price_crawled_at IS NULL
      );

    DROP MATERIALIZED VIEW IF EXISTS latest_prices;
  END IF;

  CREATE MATERIALIZED VIEW IF NOT EXISTS latest_prices AS
  SELECT DISTINCT ON (p.model_year_id) p.model_year_id, p.price_brl, p.fipe_code
  FROM prices p JOIN reference_tables rt ON p.reference_table_id = rt.id
  WHERE rt.published_at IS NOT NULL
  ORDER BY p.model_year_id, rt.year DESC, rt.month DESC
  WITH DATA;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_latest_prices_model_year ON latest_prices(model_year_id);

  IF adopting_publication THEN
    -- Existing published data predates these retry markers; the migration-created
    -- materialized view is current for it, and existing backup history is external.
    UPDATE reference_tables
    SET latest_prices_refreshed_at = COALESCE(latest_prices_refreshed_at, published_at),
        backup_completed_at = COALESCE(backup_completed_at, published_at)
    WHERE published_at IS NOT NULL;

    -- Recreate known grants after replacing the legacy view. Older servers require ownership to refresh.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fipe_app') THEN
      GRANT SELECT ON latest_prices TO fipe_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fipe_ingest') THEN
      GRANT SELECT ON latest_prices TO fipe_ingest;
      IF current_setting('server_version_num')::int >= 170000 THEN
        EXECUTE 'GRANT MAINTAIN ON latest_prices TO fipe_ingest';
      END IF;
    END IF;
  END IF;
END $migration$;

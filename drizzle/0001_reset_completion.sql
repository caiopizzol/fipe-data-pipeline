-- Older crawls marked partial references complete. Preserve data and per-item progress.
UPDATE reference_tables SET crawled_at = NULL;

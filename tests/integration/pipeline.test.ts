import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, expect, test } from "vite-plus/test";
import { sql } from "drizzle-orm";
import { runRefresh } from "../../src/commands/refresh.js";
import { crawl } from "../../src/commands/crawl.js";
import { createConnection } from "../../src/db/connection.js";
import { migrateDatabase } from "../../src/db/migrate.js";
import { createRepository } from "../../src/db/repository.js";
import type { FipeApi } from "../../src/fipe/client.js";
import type { Price } from "../../src/fipe/schemas.js";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("TEST_DATABASE_URL must name a disposable database ending in _test");
const connection = createConnection(url);
const repo = createRepository(connection.db);
const calls: string[] = [];
let failPrice = false;
const api: FipeApi = {
  getReferenceTables: async () => [{ Codigo: 328, Mes: "junho/2024" }],
  getBrands: async () => [
    { Value: "59", Label: "VW" },
    { Value: "25", Label: "Other" },
  ],
  getModels: async (_ref, brand) => {
    calls.push(`models:${brand}`);
    return { Modelos: [{ Value: brand === "59" ? 5940 : 9000, Label: `Model ${brand}` }] };
  },
  getYears: async (_ref, brand, model) => {
    calls.push(`years:${brand}/${model}`);
    return [{ Value: "2024-1", Label: "2024 Gasolina" }];
  },
  getPrice: async (params) => {
    calls.push(`price:${params.brandCode}/${params.modelCode}`);
    if (failPrice) throw new Error("simulated price failure");
    return { Valor: "R$ 4.147,00", CodigoFipe: `code-${params.modelCode}` } as Price;
  },
};
const options = { referenceCode: 328, onProgress: () => {} };
beforeAll(async () => {
  await migrateDatabase(url);
  const [fresh] = await connection.db.execute(
    sql`SELECT count(*)::int AS total FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  expect(fresh.total).toBe(8);
  await connection.db.execute(sql`DROP SCHEMA public CASCADE`);
  await connection.db.execute(sql`CREATE SCHEMA public`);
  await connection.db.execute(sql`DROP SCHEMA drizzle CASCADE`);
  const baseline = await readFile(
    new URL("../fixtures/legacy-schema.sql", import.meta.url),
    "utf8",
  );
  for (const statement of baseline.split("--> statement-breakpoint")) {
    await connection.db.execute(sql.raw(statement));
  }
  await connection.db.execute(
    sql`INSERT INTO reference_tables (code, month, year, crawled_at) VALUES (1, 1, 2001, now())`,
  );
  await migrateDatabase(url);
  const [legacy] = await connection.db.execute(
    sql`SELECT crawled_at FROM reference_tables WHERE code = 1`,
  );
  expect(legacy.crawled_at).toBeNull();
  await migrateDatabase(url);
  await connection.db.execute(
    sql`INSERT INTO reference_tables (code, month, year, published_at) VALUES (2, 2, 2001, '2001-02-01')`,
  );
  await connection.db.execute(sql`DROP SCHEMA drizzle CASCADE`);
  await migrateDatabase(url);
  const existing = await repo.getReferenceByCode(2);
  expect(existing?.publishedAt?.toISOString()).toBe("2001-02-01T00:00:00.000Z");
  expect(existing?.latestPricesRefreshedAt).toBeNull();
  expect(existing?.backupCompletedAt).toBeNull();
});
beforeEach(async () => {
  await connection.db.execute(
    sql`TRUNCATE reference_tables,brands,models,model_years,prices,reference_brands,reference_models,reference_model_years RESTART IDENTITY CASCADE`,
  );
  calls.length = 0;
  failPrice = false;
});
afterAll(async () => {
  await connection.close();
});

test("fresh setup supports a full unpublished crawl and resumes without fetching prices", async () => {
  expect(await crawl(options, repo, api)).toEqual({ references: 1, prices: 2, failed: 0 });
  expect((await repo.getReferenceCrawlProgress(328))?.completedAt).not.toBeNull();
  calls.length = 0;
  expect((await crawl(options, repo, api)).prices).toBe(0);
  expect(calls).toEqual([]);
});

test("targeted resume leaves unrelated pending models and prices untouched", async () => {
  failPrice = true;
  expect((await crawl(options, repo, api)).failed).toBe(2);
  expect((await repo.getReferenceCrawlProgress(328))?.completedAt).toBeNull();
  failPrice = false;
  calls.length = 0;
  const result = await crawl({ ...options, brandCodes: ["59"], modelCodes: ["5940"] }, repo, api);
  expect(result.prices).toBe(1);
  expect(calls).toEqual(["models:59", "price:59/5940"]);
  expect((await repo.getReferenceCrawlProgress(328))?.modelYears.pending).toBe(1);
});

test("force resets only the selected checkpoints and a failed force resumes normally", async () => {
  await crawl(options, repo, api);
  calls.length = 0;
  failPrice = true;
  expect(
    (await crawl({ ...options, brandCodes: ["59"], modelCodes: ["5940"], force: true }, repo, api))
      .failed,
  ).toBe(1);
  expect(calls).toEqual(["models:59", "years:59/5940", "price:59/5940"]);
  const progress = await repo.getReferenceCrawlProgress(328);
  expect(progress?.modelYears.pending).toBe(1);
  expect(progress?.completedAt).not.toBeNull();
  failPrice = false;
  calls.length = 0;
  await crawl(options, repo, api);
  expect(calls).toEqual(["price:59/5940"]);
  expect((await repo.getReferenceCrawlProgress(328))?.completedAt).not.toBeNull();
});

test("scoped discovery does not claim complete coverage", async () => {
  await crawl({ ...options, brandCodes: ["59"], modelCodes: ["5940"] }, repo, api);
  const progress = await repo.getReferenceCrawlProgress(328);
  expect(progress?.completedAt).toBeNull();
  expect(progress?.brands.pending).toBe(1);
});

test("an empty reference has no completion marker", async () => {
  await repo.getOrCreateReferenceTable(328, 6, 2024);
  expect((await repo.getReferenceCrawlProgress(328))?.completedAt).toBeNull();
});

test("crawl lock rejects overlap and is released after errors", async () => {
  const other = createConnection(url);
  try {
    await connection.withCrawlLock(async () => {
      await expect(other.withCrawlLock(async () => {})).rejects.toThrow("Another crawl");
    });
    await expect(
      connection.withCrawlLock(async () => {
        throw new Error("failed run");
      }),
    ).rejects.toThrow("failed run");
    await other.withCrawlLock(async () => {});
  } finally {
    await other.close();
  }
});

test("explicit consumer refresh fails when missing, then refreshes after resume even without new prices", async () => {
  await connection.db.execute(sql`DROP MATERIALIZED VIEW latest_prices`);
  await expect(crawl({ ...options, refreshLatestPrices: true }, repo, api)).rejects.toThrow();
  expect((await repo.getStats()).prices).toBe(2);
  await connection.db.execute(
    sql`CREATE MATERIALIZED VIEW latest_prices AS SELECT p.model_year_id, p.price_brl FROM prices p JOIN reference_tables rt ON p.reference_table_id = rt.id WHERE rt.published_at IS NOT NULL`,
  );
  await connection.db.execute(
    sql`CREATE UNIQUE INDEX latest_prices_model_year ON latest_prices(model_year_id)`,
  );
  try {
    await repo.markReferencePublished(328);
    await connection.db.execute(sql`UPDATE prices SET price_brl = 5000`);
    expect((await crawl({ ...options, refreshLatestPrices: true }, repo, api)).prices).toBe(0);
    const rows = await connection.db.execute(sql`SELECT price_brl FROM latest_prices`);
    expect(rows.every((row) => row.price_brl === "5000.00")).toBe(true);
  } finally {
    await repo.refreshLatestPrices();
  }
});

test("classification failure leaves discovery running and reports a retryable failure", async () => {
  const original = api.getModels;
  api.getModels = async () => ({
    Modelos: [
      { Value: 1, Label: "First" },
      { Value: 2, Label: "Second" },
    ],
  });
  let classified = 0;
  try {
    const result = await crawl({ ...options, brandCodes: ["59"] }, repo, api, async () => {
      if (classified++ === 0) throw new Error("transient classifier failure");
      return "SUV";
    });
    expect(result.failed).toBe(1);
    expect(result.prices).toBe(2);
    expect((await repo.getModelsWithoutSegment()).map((model) => model.modelName)).toEqual([
      "First",
    ]);
  } finally {
    api.getModels = original;
  }
});

test("brand-only crawl followed by a full run fills missing coverage without refetching completed brands", async () => {
  await crawl({ ...options, brandCodes: ["59"] }, repo, api);
  expect((await repo.getReferenceCrawlProgress(328))?.completedAt).toBeNull();
  calls.length = 0;
  await crawl(options, repo, api);
  expect(calls).toEqual(["models:25", "years:25/9000", "price:25/9000"]);
  expect((await repo.getReferenceCrawlProgress(328))?.completedAt).not.toBeNull();
});

test("a lost reserved connection does not hide the original crawl failure", async () => {
  const damaged = createConnection(url);
  try {
    await expect(
      damaged.withCrawlLock(async () => {
        await connection.db.execute(
          sql`SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype='advisory' AND classid=17486 AND objid=1 AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`,
        );
        throw new Error("original crawl failure");
      }),
    ).rejects.toThrow("original crawl failure");
  } finally {
    await damaged.close();
  }
}, 15000);

test("CLI reports a failed crawl with exit 1 and releases its database lock", async () => {
  const child = spawnSync(
    "bun",
    [
      "--no-env-file",
      "--preload",
      "./tests/fixtures/failing-fipe.ts",
      "src/index.ts",
      "crawl",
      "--reference",
      "328",
    ],
    {
      env: { PATH: process.env.PATH, DATABASE_URL: url },
      encoding: "utf8",
      timeout: 15000,
    },
  );
  const { status: code, stdout: out, stderr: error } = child;
  expect(code).toBe(1);
  expect(out).toContain("simulated FIPE outage");
  expect(error).toContain("Crawl incomplete");
  expect((await repo.getReferenceCrawlProgress(328))?.modelYears.pending).toBe(1);
  await connection.withCrawlLock(async () => {});
});

test("refresh publishes only after a successful crawl and retries an unfinished backup", async () => {
  let backups = 0;
  const dependencies = {
    repo,
    api,
    acquireLock: () => connection.acquireRefreshLock(),
    crawl: (scope: Parameters<typeof crawl>[0]) =>
      connection.withCrawlLock(() => crawl(scope, repo, api)),
    runBackup: async () => {
      if (backups++ === 0) throw new Error("simulated storage failure");
    },
  };
  const settings = { backup: true, log: () => {}, error: () => {} };
  expect(await runRefresh(settings, dependencies)).toBe(1);
  const published = await repo.getReferenceByCode(328);
  expect(published?.publishedAt).not.toBeNull();
  expect(published?.latestPricesRefreshedAt).not.toBeNull();
  expect(published?.backupCompletedAt).toBeNull();
  const rows = await connection.db.execute(sql`SELECT * FROM latest_prices`);
  expect(rows).toHaveLength(2);
  calls.length = 0;
  expect(await runRefresh(settings, dependencies)).toBe(0);
  expect(calls).toEqual([]);
  expect(backups).toBe(2);
  expect((await repo.getReferenceByCode(328))?.backupCompletedAt).not.toBeNull();
});

test("refresh leaves a reference unpublished when the crawler reports failed prices", async () => {
  failPrice = true;
  const result = await runRefresh(
    { log: () => {}, error: () => {} },
    {
      repo,
      api,
      acquireLock: () => connection.acquireRefreshLock(),
      crawl: (scope) => connection.withCrawlLock(() => crawl(scope, repo, api)),
      runBackup: async () => {
        throw new Error("Unexpected backup");
      },
    },
  );
  expect(result).toBe(1);
  expect((await repo.getReferenceByCode(328))?.publishedAt).toBeNull();
  await repo.refreshLatestPrices();
  expect(await connection.db.execute(sql`SELECT * FROM latest_prices`)).toHaveLength(0);
});

test("a held refresh lock skips all publication work and is reusable after release", async () => {
  const lock = await connection.acquireRefreshLock();
  expect(lock).toBeDefined();
  try {
    expect(
      await runRefresh(
        { log: () => {}, error: () => {} },
        {
          repo,
          api: {
            ...api,
            getReferenceTables: async () => {
              throw new Error("Unexpected FIPE call");
            },
          },
          acquireLock: () => connection.acquireRefreshLock(),
          crawl: async () => {
            throw new Error("Unexpected crawl");
          },
          runBackup: async () => {
            throw new Error("Unexpected backup");
          },
        },
      ),
    ).toBe(0);
  } finally {
    await lock?.release();
  }
  const next = await connection.acquireRefreshLock();
  expect(next).toBeDefined();
  await next?.release();
});

test("adopting the upstream schema preserves publication decisions, retry markers and dependent views", async () => {
  await connection.db.execute(sql`DROP SCHEMA public CASCADE`);
  await connection.db.execute(sql`CREATE SCHEMA public`);
  await connection.db.execute(sql`DROP SCHEMA drizzle CASCADE`);
  await connection.db.execute(
    sql.raw(await readFile(new URL("../fixtures/published-schema.sql", import.meta.url), "utf8")),
  );
  await connection.db.execute(sql`
    INSERT INTO reference_tables (code, month, year, published_at, latest_prices_refreshed_at, backup_completed_at)
      VALUES (1, 1, 2026, '2026-01-01', '2026-01-02', '2026-01-03'),
             (2, 2, 2026, '2026-02-01', NULL, NULL),
             (3, 3, 2026, NULL, NULL, NULL);
    INSERT INTO brands (fipe_code, name) VALUES ('test', 'Test Brand');
    INSERT INTO models (brand_id, fipe_code, name) VALUES (1, 'test', 'Test Model');
    INSERT INTO model_years (model_id, year, fuel_code) VALUES (1, 2025, 1);
    INSERT INTO prices (model_year_id, reference_table_id, fipe_code, price_brl)
      VALUES (1, 1, 'test', 100), (1, 2, 'test', 200), (1, 3, 'test', 300);
    REFRESH MATERIALIZED VIEW latest_prices;
    CREATE VIEW latest_prices_reader AS SELECT * FROM latest_prices;
  `);
  const publication = sql`SELECT code, published_at, latest_prices_refreshed_at, backup_completed_at FROM reference_tables ORDER BY code`;
  const before = await connection.db.execute(publication);
  await migrateDatabase(url);
  await migrateDatabase(url);
  expect(await connection.db.execute(publication)).toEqual(before);
  const rows = await connection.db.execute(sql`SELECT price_brl FROM latest_prices_reader`);
  expect(rows).toHaveLength(1);
  expect(rows[0].price_brl).toBe("200.00");
});

import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vite-plus/test";
import { TestPostgres } from "../test/postgres.js";
import { crawl } from "./processor.js";
import { runRefresh } from "./refresh.js";

vi.mock("../fipe/client.js", () => ({
  fipeClient: {
    getReferenceTables: async () => [
      { Codigo: 1, Mes: "janeiro/2026" },
      { Codigo: 2, Mes: "fevereiro/2026" },
    ],
  },
}));

vi.mock("./processor.js", () => ({ crawl: vi.fn(async () => {}) }));

const postgres = new TestPostgres();
let connection: typeof import("../db/connection.js") | undefined;

beforeAll(async () => {
  await postgres.start(true);
  postgres.sql("postgres", readFileSync(new URL("../../initial.sql", import.meta.url), "utf8"));

  vi.stubEnv("DATABASE_URL", postgres.url("postgres"));
  for (const name of [
    "HC_REFRESH_URL",
    "FIPE_PROXY",
    "R2_ENDPOINT",
    "RATE_LIMIT_MS",
    "MAX_THROTTLE_MS",
    "MAX_RETRIES",
  ]) {
    vi.stubEnv(name, undefined);
  }
  vi.resetModules();
  connection = await import("../db/connection.js");
}, 180_000);

afterAll(async () => {
  try {
    await connection?.closeConnection();
  } finally {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.doUnmock("../fipe/client.js");
    vi.doUnmock("./processor.js");
    vi.resetModules();
    postgres.stop();
  }
}, 140_000);

beforeEach(() => {
  vi.clearAllMocks();
  postgres.sql(
    "postgres",
    `TRUNCATE reference_tables, brands RESTART IDENTITY CASCADE;
     INSERT INTO reference_tables
       (code, month, year, published_at, latest_prices_refreshed_at, backup_completed_at)
       VALUES (1, 1, 2026, '2026-01-01', '2026-01-01', '2026-01-01'),
              (2, 2, 2026, NULL, NULL, NULL);
     INSERT INTO brands (fipe_code, name) VALUES ('test', 'Test Brand');
     INSERT INTO models (brand_id, fipe_code, name) VALUES (1, 'test', 'Test Model');
     INSERT INTO model_years (model_id, year, fuel_code)
       SELECT 1, year, 1 FROM generate_series(2016, 2025) AS year;
     INSERT INTO prices (model_year_id, reference_table_id, fipe_code, price_brl)
       SELECT id, 1, 'test', 100 FROM model_years;
     REFRESH MATERIALIZED VIEW latest_prices;`,
  );
});

test.each([
  { priceCount: 8, exitCode: 1, published: false },
  { priceCount: 9, exitCode: 0, published: true },
])(
  "runRefresh with $priceCount of 10 previous prices: published=$published",
  async ({ priceCount, exitCode, published }) => {
    postgres.sql(
      "postgres",
      `INSERT INTO prices (model_year_id, reference_table_id, fipe_code, price_brl)
         SELECT id, 2, 'test', 200 FROM model_years WHERE id <= ${priceCount};`,
    );
    if (!connection) throw new Error("Test database was not initialized");
    const sql = connection.postgresClient;
    const before = await sql`SELECT code, published_at FROM reference_tables ORDER BY code`;
    const error = vi.fn();

    expect(await runRefresh({ log: vi.fn(), error })).toBe(exitCode);

    const after = await sql`SELECT code, published_at FROM reference_tables ORDER BY code`;
    expect(after).toHaveLength(2);
    expect(after[0]).toEqual(before[0]);
    expect(after[1]).toEqual({ code: 2, published_at: published ? expect.any(String) : null });
    expect(crawl).toHaveBeenCalledExactlyOnceWith({
      referenceCode: 2,
      onProgress: expect.any(Function),
    });
    if (published) {
      expect(error).not.toHaveBeenCalled();
    } else {
      expect(error).toHaveBeenCalledWith("[refresh] price count: current=8 previous=10 minimum=9");
    }
  },
  30_000,
);

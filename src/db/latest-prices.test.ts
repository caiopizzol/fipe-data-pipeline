import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";

const container = `fipe-publication-test-${randomUUID()}`;
let created = false;

function docker(args: string[], input?: string): string {
  return execFileSync("docker", args, {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 120_000,
  }).trim();
}

function sql(database: string, query: string): string {
  return docker(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    query,
  );
}

beforeAll(async () => {
  docker([
    "create",
    "--name",
    container,
    "-e",
    "POSTGRES_PASSWORD=publication-test",
    "postgres:17-alpine",
  ]);
  created = true;
  docker(["start", container]);

  for (let attempt = 0; attempt < 60; attempt++) {
    const ready = spawnSync(
      "docker",
      ["exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"],
      { stdio: "pipe", timeout: 5_000 },
    );
    if (ready.status === 0) return;
    await setTimeout(500);
  }
  throw new Error(`Test PostgreSQL did not become ready: ${docker(["logs", container])}`);
}, 180_000);

afterAll(() => {
  if (created) docker(["rm", "-f", "-v", container]);
}, 130_000);

test.each(["initial", "migration"] as const)(
  "%s latest_prices excludes unpublished references until publication",
  (source) => {
    sql("postgres", `CREATE DATABASE ${source};`);
    sql(source, readFileSync(new URL("../../initial.sql", import.meta.url), "utf8"));
    if (source === "migration") {
      sql(
        source,
        readFileSync(new URL("../../migrations/001_published_at.sql", import.meta.url), "utf8"),
      );
    }

    sql(
      source,
      `INSERT INTO reference_tables (code, month, year, published_at)
         VALUES (1, 1, 2026, NOW()), (2, 2, 2026, NOW()), (3, 3, 2026, NULL);
       INSERT INTO brands (fipe_code, name) VALUES ('test', 'Test Brand');
       INSERT INTO models (brand_id, fipe_code, name) VALUES (1, 'test', 'Test Model');
       INSERT INTO model_years (model_id, year, fuel_code) VALUES (1, 2024, 1), (1, 2025, 1);
       INSERT INTO prices (model_year_id, reference_table_id, fipe_code, price_brl)
         VALUES (1, 1, 'test', 80), (1, 2, 'test', 100), (1, 3, 'test', 200),
                (2, 3, 'test', 300);
       REFRESH MATERIALIZED VIEW CONCURRENTLY latest_prices;`,
    );

    const query = "SELECT model_year_id, price_brl FROM latest_prices ORDER BY model_year_id;";
    expect(sql(source, query)).toBe("1|100.00");

    sql(
      source,
      `UPDATE reference_tables SET published_at = NOW() WHERE code = 3;
       REFRESH MATERIALIZED VIEW CONCURRENTLY latest_prices;`,
    );
    expect(sql(source, query)).toBe("1|200.00\n2|300.00");
  },
  30_000,
);

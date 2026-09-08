import { expect, test } from "vite-plus/test";
import {
  readBackupConfig,
  readClassificationKey,
  readCrawlerConfig,
  readDatabaseConfig,
} from "./config.js";

test("validates only configuration needed by the command", () => {
  expect(
    readDatabaseConfig({ DATABASE_URL: "postgres://localhost/fipe", R2_ENDPOINT: "" }),
  ).toEqual({ DATABASE_URL: "postgres://localhost/fipe" });
  expect(readCrawlerConfig({ FIPE_PROXY: "" }).FIPE_PROXY).toBeUndefined();
  expect(() => readBackupConfig({})).toThrow("R2_BUCKET");
  expect(() => readClassificationKey({})).toThrow("ANTHROPIC_API_KEY");
});
test.each([
  { MAX_RETRIES: "-1" },
  { MAX_RETRIES: "1.5" },
  { RATE_LIMIT_MS: "-10" },
  { RATE_LIMIT_MS: "5000", MAX_THROTTLE_MS: "100" },
])("rejects invalid crawler settings %j", (value) => {
  expect(() => readCrawlerConfig(value)).toThrow();
});

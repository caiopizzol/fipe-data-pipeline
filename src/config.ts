import { z } from "zod";

type Environment = Record<string, string | undefined>;
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
const databaseSchema = z.object({
  DATABASE_URL: z.url().refine((url) => /^postgres(ql)?:/.test(url), "Expected a PostgreSQL URL"),
});
const crawlerSchema = z
  .object({
    RATE_LIMIT_MS: z.coerce.number().int().positive().default(800),
    MAX_THROTTLE_MS: z.coerce.number().int().positive().default(5000),
    MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
    FIPE_PROXY: optional(z.url()),
    REFRESH_LATEST_PRICES: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
  })
  .refine((value) => value.MAX_THROTTLE_MS >= value.RATE_LIMIT_MS, {
    message: "Must be at least RATE_LIMIT_MS",
    path: ["MAX_THROTTLE_MS"],
  });
const refreshSchema = z.object({ HC_REFRESH_URL: optional(z.url()) });
export const readRefreshConfig = (source: Environment = process.env) =>
  parse(refreshSchema, source);
const backupSchema = databaseSchema.extend({
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_ENDPOINT: z.url(),
  R2_BUCKET: z.string().min(1),
});

function parse<T>(schema: z.ZodType<T>, source: Environment): T {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new Error(
      `Invalid configuration: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  return result.data;
}

export const readDatabaseConfig = (source: Environment = process.env) =>
  parse(databaseSchema, source);
export const readCrawlerConfig = (source: Environment = process.env) =>
  parse(crawlerSchema, source);
export const readBackupConfig = (source: Environment = process.env) => parse(backupSchema, source);
export function readClassificationKey(source: Environment = process.env): string {
  const key = source.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY is required for classification");
  return key;
}
export type CrawlerConfig = ReturnType<typeof readCrawlerConfig>;
export type BackupConfig = ReturnType<typeof readBackupConfig>;

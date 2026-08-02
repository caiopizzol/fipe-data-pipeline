import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../config.js";
import * as schema from "./schema.js";

export const postgresClient = postgres(env.DATABASE_URL, {
  max: 20,
  // A monthly refresh reserves one connection for longer than Postgres.js's
  // default 30-60 minute lifetime. Expiring that reserved connection leaves
  // end() waiting forever after the advisory lock is released.
  max_lifetime: null,
});

export const db = drizzle(postgresClient, { schema });

export type Database = typeof db;

export async function closeConnection() {
  await postgresClient.end({ timeout: 5 });
}

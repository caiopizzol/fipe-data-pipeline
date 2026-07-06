import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../config.js';
import * as schema from './schema.js';

export const postgresClient = postgres(env.DATABASE_URL, { max: 20 });

export const db = drizzle(postgresClient, { schema });

export type Database = typeof db;

export async function closeConnection() {
  await postgresClient.end();
}

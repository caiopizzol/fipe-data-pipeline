import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../config.js';
import * as schema from './schema.js';

const client = postgres(env.DATABASE_URL);

export const db = drizzle(client, { schema });

export type Database = typeof db;

export async function closeConnection() {
  await client.end();
}

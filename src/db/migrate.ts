import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { readDatabaseConfig } from '../config.js';
import { createConnection } from './connection.js';

export async function migrateDatabase(url: string) {
  const connection = createConnection(url);
  try {
    await migrate(connection.db, {
      migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
    });
  } finally {
    await connection.close();
  }
}

if (import.meta.main) {
  await migrateDatabase(readDatabaseConfig().DATABASE_URL);
}

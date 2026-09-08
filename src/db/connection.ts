import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export function createConnection(url: string) {
  const client = postgres(url, { max: 5, connection: { client_min_messages: 'warning' } });
  return {
    db: drizzle(client, { schema }),
    close: () => client.end({ timeout: 1 }),
    async withCrawlLock<T>(work: () => Promise<T>): Promise<T> {
      const session = await client.reserve();
      try {
        const [row] = await session`SELECT pg_try_advisory_lock(17486, 1) AS locked`;
        if (!row.locked) throw new Error('Another crawl is running against this database');
        const errors: unknown[] = [];
        let result: T | undefined;
        try {
          result = await work();
        } catch (error) {
          errors.push(error);
        }
        try {
          await session`SELECT pg_advisory_unlock(17486, 1)`;
        } catch (error) {
          errors.push(new Error('Failed to release crawl lock', { cause: error }));
        }
        if (errors.length)
          throw new AggregateError(
            errors,
            errors.map((e) => (e instanceof Error ? e.message : String(e))).join('; '),
          );
        return result as T;
      } finally {
        session.release();
      }
    },
  };
}
export type Database = ReturnType<typeof createConnection>['db'];

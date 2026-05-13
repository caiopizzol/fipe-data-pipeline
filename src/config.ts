import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DB_PORT: z.coerce.number().default(5433),
  RATE_LIMIT_MS: z.coerce.number().default(800),
  MAX_THROTTLE_MS: z.coerce.number().default(5000),
  MAX_RETRIES: z.coerce.number().default(3),
  ANTHROPIC_API_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten());
  process.exit(1);
}

export const env = parsed.data;

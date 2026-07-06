import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  RATE_LIMIT_MS: z.coerce.number().default(800),
  MAX_THROTTLE_MS: z.coerce.number().default(5000),
  MAX_RETRIES: z.coerce.number().default(3),
  ANTHROPIC_API_KEY: z.string().optional(),
  FIPE_PROXY: z.string().url().optional(),
  HC_REFRESH_URL: z.string().url().optional(),
  // R2 backup target (used by the `backup` / `restore-drill` commands only).
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_ENDPOINT: z.string().url().optional(),
  R2_BUCKET: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten());
  process.exit(1);
}

export const env = parsed.data;

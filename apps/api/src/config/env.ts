import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).default('postgres://folio:folio@localhost:5442/folio'),
  MARKET_GATEWAY_URL: z.url().default('http://127.0.0.1:8081'),
  MARKET_GATEWAY_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
});

export type Env = z.infer<typeof envSchema>;

/** Fails fast at boot with every bad variable listed, instead of at first use. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

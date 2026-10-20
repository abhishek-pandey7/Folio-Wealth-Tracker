import { type Database, schema } from '@folio/core';
import { eq, sql } from 'drizzle-orm';

/** Lets a request finish while work it started (a cache refresh) carries on: ExecutionContext.waitUntil. */
export type Defer = (work: Promise<unknown>) => void;

export interface CachePolicy {
  /** Served as fresh for this long. */
  ttlMs: number;
  /**
   * After the TTL, still served for this long while a refresh runs in the
   * background, and served when the provider is down (stale-if-error).
   */
  staleMs: number;
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/**
 * A read-through cache in Postgres. The Go gateway keeps these in memory; a
 * Worker's memory does not outlive the request, so the table is the memory.
 * Returns the value and whether it is stale.
 */
export async function cached<T>(
  db: Database,
  defer: Defer,
  key: string,
  policy: CachePolicy,
  load: () => Promise<T>,
): Promise<{ value: T; stale: boolean }> {
  const [row] = await db.select().from(schema.marketCache).where(eq(schema.marketCache.key, key));
  const age = row ? Date.now() - row.fetchedAt.getTime() : Number.POSITIVE_INFINITY;
  if (row && age < policy.ttlMs) return { value: row.value as T, stale: false };

  const refresh = async () => {
    const value = await load();
    await put(db, key, value);
    return value;
  };
  if (row && age < policy.ttlMs + policy.staleMs) {
    defer(refresh().catch(() => undefined)); // the stale value is good enough meanwhile
    return { value: row.value as T, stale: false };
  }
  try {
    return { value: await refresh(), stale: false };
  } catch (error) {
    if (row) return { value: row.value as T, stale: true };
    throw error;
  }
}

async function put(db: Database, key: string, value: unknown): Promise<void> {
  await db
    .insert(schema.marketCache)
    .values({ key, value, fetchedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.marketCache.key,
      set: { value: sql`excluded.value`, fetchedAt: sql`excluded.fetched_at` },
    });
}

import { type Database, schema } from '@folio/core';
import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dueForQuotes, dueForStats, prioritySymbols } from './jobs.js';
import { curatedSymbols } from './market/universe.js';

// Integration test: runs against a real, migrated Postgres when DATABASE_URL is set (CI provides one).
// Only reads which symbols are due, so it never touches rows other tests or a dev stack rely on.
const databaseUrl = process.env.DATABASE_URL;

const tag = Math.floor(Math.random() * 1e6)
  .toString()
  .padStart(6, '0');
const HELD = `JH${tag}.NS`; // has an instruments row: someone holds, synced or starred it
const INDEX_ONLY = `JI${tag}.NS`; // an index member nobody holds
const CURATED = curatedSymbols()[0] as string;

const HOUR = 3_600_000;
const NOW = new Date('2026-11-26T06:00:00Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

describe.skipIf(!databaseUrl)('refresh tiers (Postgres)', () => {
  let client: Client;
  let db: Database;
  let curatedRowExisted = false;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    db = drizzle({ client, schema });
    await db
      .insert(schema.instruments)
      .values({ symbol: HELD, name: 'Held Ltd', assetClass: 'equity', currency: 'INR' });
    const quoted = { currency: 'INR' as const, quoteAt: ago(2), statsAt: ago(5) };
    await db.insert(schema.symbolData).values([
      { symbol: HELD, ...quoted },
      { symbol: INDEX_ONLY, ...quoted },
    ]);
    curatedRowExisted =
      (
        await db
          .select()
          .from(schema.symbolData)
          .where(inArray(schema.symbolData.symbol, [CURATED]))
      ).length > 0;
  });

  afterAll(async () => {
    await db.delete(schema.symbolData).where(inArray(schema.symbolData.symbol, [HELD, INDEX_ONLY]));
    await db.delete(schema.instruments).where(inArray(schema.instruments.symbol, [HELD]));
    await client.end();
  });

  const ours = (symbols: string[]) => symbols.filter((s) => s === HELD || s === INDEX_ONLY);

  it('puts held symbols on the frequent schedule and index-only members on the slow one', async () => {
    // Quotes two hours old: due on the frequent (10 minute) schedule only if held.
    expect(ours(await dueForQuotes(db, prioritySymbols(), 10 * 60_000, NOW, 100_000))).toEqual([HELD]);
    // On the index schedule (hourly) both are due: it covers everything that has gone stale.
    expect(ours(await dueForQuotes(db, undefined, HOUR, NOW, 100_000)).sort()).toEqual([HELD, INDEX_ONLY].sort());
    // Statistics five hours old: past the 3 hour priority limit, inside the 24 hour index limit.
    expect(ours(await dueForStats(db, prioritySymbols(), 3 * HOUR, NOW, 100_000))).toEqual([HELD]);
    expect(ours(await dueForStats(db, undefined, 24 * HOUR, NOW, 100_000))).toEqual([]);
  });

  it('treats the curated lists as priority without an instruments row', async () => {
    if (!curatedRowExisted) {
      await db.insert(schema.symbolData).values({ symbol: CURATED }).onConflictDoNothing();
    }
    const due = await dueForStats(db, prioritySymbols(), 0, new Date(Date.now() + 1000), 100_000);
    expect(due).toContain(CURATED);
    expect(due).not.toContain(INDEX_ONLY);
  });
});

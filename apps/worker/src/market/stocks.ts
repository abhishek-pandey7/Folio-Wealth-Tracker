// Stock, ETF and index data in symbol_data: statistics from one chart call per
// symbol, quotes 20 at a time from spark (its limit).

import { AppError, type Database, schema, UpstreamError } from '@folio/core';
import type { SymbolStats } from '@folio/shared';
import { inArray, sql } from 'drizzle-orm';
import { computeMetrics, type Point } from './analytics.js';
import { sectorOf } from './universe.js';
import { decimal, pool } from './upstream.js';
import * as yahoo from './yahoo.js';

export type SymbolRow = typeof schema.symbolData.$inferSelect;

const { symbolData } = schema;
const YEAR_MS = 365 * 86_400_000;

export async function readSymbols(db: Database, symbols: string[]): Promise<Map<string, SymbolRow>> {
  if (symbols.length === 0) return new Map();
  const rows = await db.select().from(symbolData).where(inArray(symbolData.symbol, symbols));
  return new Map(rows.map((r) => [r.symbol, r]));
}

/** A failure that belongs to the symbol (unknown, unsupported currency), not to the provider being down. */
const isSymbolError = (error: unknown) => error instanceof AppError && error.status < 500;

const identityOf = (row: SymbolRow | undefined): yahoo.Identity | undefined =>
  row?.currency
    ? { symbol: row.symbol, name: row.name ?? row.symbol, exchange: row.exchange ?? '', currency: row.currency }
    : undefined;

export function buildStats(identity: yahoo.Identity, points: Point[]): SymbolStats {
  const last = points.at(-1) as Point;
  const year = points.filter((p) => p.date > last.date - YEAR_MS).map((p) => p.value);
  const high = year.length ? Math.max(...year) : null;
  const low = year.length ? Math.min(...year) : null;
  return {
    symbol: identity.symbol,
    name: identity.name,
    exchange: identity.exchange,
    currency: identity.currency,
    sector: sectorOf(identity.symbol),
    price: decimal(last.value),
    // From daily closes, so slightly inside the intraday range a broker shows.
    high52w: high === null ? null : Number(high.toFixed(4)),
    low52w: low === null ? null : Number(low.toFixed(4)),
    fromHigh52w: high ? Math.round((last.value / high - 1) * 10_000) / 100 : null,
    metrics: computeMetrics(points),
  };
}

/**
 * Symbols per refresh. Each costs ~1.6 ms of CPU (parsing five years of
 * closes, then the statistics), and a free-plan invocation gets 10 ms.
 */
export const STATS_BATCH = 4;

/**
 * Recomputes statistics for a few symbols from five years of daily closes
 * adjusted for dividends, one chart call each (which also brings the name,
 * exchange and currency). Symbol-specific failures are stored on the row so
 * the job stops retrying them every minute.
 */
export async function refreshStats(db: Database, symbols: string[]): Promise<{ refreshed: number; failed: number }> {
  const rowsBefore = await readSymbols(db, symbols);
  const failures = new Map<string, string>();
  const providerErrors: string[] = [];
  const updates: SymbolStats[] = [];
  await pool(symbols, 4, async (s) => {
    try {
      const c = await yahoo.chart(s, '5y', '1d');
      if (c.adjusted.length < 2) failures.set(s, `Not enough price history for ${s}`);
      else updates.push(buildStats({ ...c.identity, symbol: s }, c.adjusted));
    } catch (error) {
      if (isSymbolError(error)) failures.set(s, (error as Error).message);
      else providerErrors.push((error as Error).message);
    }
  });

  const now = new Date();
  if (updates.length) {
    await db
      .insert(symbolData)
      .values(
        updates.map((st) => ({
          symbol: st.symbol,
          name: st.name,
          exchange: st.exchange,
          currency: st.currency,
          stats: st,
          statsAt: now,
          error: null,
          errorAt: null,
        })),
      )
      .onConflictDoUpdate({
        target: symbolData.symbol,
        set: {
          name: sql`excluded.name`,
          exchange: sql`excluded.exchange`,
          currency: sql`excluded.currency`,
          stats: sql`excluded.stats`,
          statsAt: sql`excluded.stats_at`,
          error: sql`null`,
          errorAt: sql`null`,
        },
      });
  }
  if (failures.size) await storeErrors(db, failures);
  // A symbol seen for the first time has no quote yet; one spark call covers the batch.
  const unquoted = updates.filter((u) => !rowsBefore.get(u.symbol)?.quote).map((u) => u.symbol);
  if (unquoted.length) await refreshQuotes(db, unquoted).catch(() => 0);
  // Nothing done and the provider at fault: fail the run so the scheduler backs off instead of retrying every minute.
  if (updates.length === 0 && providerErrors.length) throw new UpstreamError(providerErrors[0] as string);
  return { refreshed: updates.length, failed: failures.size };
}

/** Refreshes quotes for symbols whose identity is known, 20 per spark call. */
export async function refreshQuotes(db: Database, symbols: string[]): Promise<number> {
  const rows = await readSymbols(db, symbols);
  const known = symbols.filter((s) => identityOf(rows.get(s)));
  const batches: string[][] = [];
  for (let i = 0; i < known.length; i += yahoo.SPARK_BATCH) batches.push(known.slice(i, i + yahoo.SPARK_BATCH));
  const results = await pool(batches, 4, (b) => yahoo.spark(b, '1d', '1d'));

  const quotes = results.flatMap((series) =>
    [...series.values()].flatMap((s) => {
      const identity = identityOf(rows.get(s.symbol));
      const price = s.close?.at(-1);
      const ts = s.timestamp?.at(-1);
      if (!identity || price === null || price === undefined || s.chartPreviousClose === undefined || !ts) return [];
      return [yahoo.toQuote(identity, price, s.chartPreviousClose, ts)];
    }),
  );
  if (quotes.length) await storeQuotes(db, quotes);
  return quotes.length;
}

export async function storeQuotes(db: Database, quotes: yahoo.Chart['quote'][]): Promise<void> {
  const now = new Date();
  await db
    .insert(symbolData)
    .values(quotes.map((q) => ({ symbol: q.symbol, currency: q.currency, quote: q, quoteAt: now })))
    .onConflictDoUpdate({
      target: symbolData.symbol,
      set: { quote: sql`excluded.quote`, quoteAt: sql`excluded.quote_at` },
    });
}

/** Stores identities learned from chart calls (name, exchange, currency). */
export async function storeIdentities(db: Database, identities: yahoo.Identity[]): Promise<void> {
  await db
    .insert(symbolData)
    .values(identities)
    .onConflictDoUpdate({
      target: symbolData.symbol,
      set: { name: sql`excluded.name`, exchange: sql`excluded.exchange`, currency: sql`excluded.currency` },
    });
}

async function storeErrors(db: Database, failures: Map<string, string>): Promise<void> {
  const now = new Date();
  await db
    .insert(symbolData)
    .values([...failures].map(([symbol, error]) => ({ symbol, error, errorAt: now })))
    .onConflictDoUpdate({
      target: symbolData.symbol,
      set: { error: sql`excluded.error`, errorAt: sql`excluded.error_at` },
    });
}

/** Makes sure each symbol has a row, so the refresh job picks it up. */
export async function track(db: Database, symbols: string[]): Promise<void> {
  if (symbols.length === 0) return;
  await db
    .insert(symbolData)
    .values(symbols.map((symbol) => ({ symbol })))
    .onConflictDoNothing();
}

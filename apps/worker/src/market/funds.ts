// Mutual fund data in fund_data: the screener's catalogue from AMFI's NAV file,
// statistics from five years of mfapi NAVs.

import { AppError, type Database, schema, UpstreamError } from '@folio/core';
import type { FundStats } from '@folio/shared';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { AMFI_URL, type AmfiCursor, parseLines, START, wholeLines } from './amfi.js';
import { computeMetrics, isoDate } from './analytics.js';
import * as mfapi from './mfapi.js';
import { categoryOf, isDirectGrowth } from './universe.js';
import { get, pool } from './upstream.js';

export type FundRow = typeof schema.fundData.$inferSelect;

const { fundData } = schema;
const DAY_MS = 86_400_000;

/** Five years and a margin: the 5y return needs a base at or before the mark. */
const historyStart = () => isoDate(Date.now() - (5 * 365.25 + 10) * DAY_MS);
const today = () => isoDate(Date.now());

export async function readFunds(db: Database, codes: string[]): Promise<Map<string, FundRow>> {
  if (codes.length === 0) return new Map();
  const rows = await db.select().from(fundData).where(inArray(fundData.schemeCode, codes));
  return new Map(rows.map((r) => [r.schemeCode, r]));
}

export function fundStatsOf(series: mfapi.NavSeries): FundStats {
  return {
    schemeCode: series.schemeCode,
    name: series.name,
    fundHouse: series.fundHouse,
    category: series.category,
    nav: series.nav,
    navDate: series.navDate,
    metrics: computeMetrics(series.points),
  };
}

/** Funds per refresh: a few ms of CPU each once warm; see docs/ARCHITECTURE.md, section 4.9. */
export const FUNDS_BATCH = 5;

/** Recomputes statistics for a few funds, one mfapi call each. */
export async function refreshFunds(db: Database, codes: string[]): Promise<{ refreshed: number; failed: number }> {
  const stats: FundStats[] = [];
  const failures = new Map<string, string>();
  const providerErrors: string[] = [];
  await pool(codes, 4, async (code) => {
    try {
      const series = await mfapi.navs(code, historyStart(), today());
      if (series.points.length < 2) failures.set(code, `Not enough NAV history for ${code}`);
      else stats.push(fundStatsOf(series));
    } catch (error) {
      if (error instanceof AppError && error.status < 500) failures.set(code, error.message);
      else providerErrors.push((error as Error).message);
    }
  });

  const now = new Date();
  if (stats.length) {
    await db
      .insert(fundData)
      .values(
        stats.map((s) => ({ schemeCode: s.schemeCode, name: s.name, fundHouse: s.fundHouse, stats: s, statsAt: now })),
      )
      .onConflictDoUpdate({
        target: fundData.schemeCode,
        set: {
          name: sql`excluded.name`,
          fundHouse: sql`excluded.fund_house`,
          stats: sql`excluded.stats`,
          statsAt: sql`excluded.stats_at`,
          error: sql`null`,
          errorAt: sql`null`,
        },
      });
  }
  if (failures.size) {
    await db
      .insert(fundData)
      .values([...failures].map(([schemeCode, error]) => ({ schemeCode, name: schemeCode, error, errorAt: now })))
      .onConflictDoUpdate({
        target: fundData.schemeCode,
        set: { error: sql`excluded.error`, errorAt: sql`excluded.error_at` },
      });
  }
  // Nothing done and the provider at fault: fail the run so the scheduler backs off instead of retrying every minute.
  if (stats.length === 0 && providerErrors.length) throw new UpstreamError(providerErrors[0] as string);
  return { refreshed: stats.length, failed: failures.size };
}

// The catalogue pass. AMFI's file changes during the day, so each pass pins the
// ETag it started with and starts over if the file changes underneath it.

/** One request's worth of the file: ~260 KB parses in a few milliseconds. */
export const CHUNK_BYTES = 256 * 1024;

export interface CatalogState {
  /** Set while a pass is in progress. */
  pass?: { startedAt: string; etag: string; offset: number; cursor: AmfiCursor; matched: number };
  /** When the last complete pass started; schemes it did not see are wound down. */
  completedAt?: string;
  completedFunds?: number;
}

/** Reads the next chunk of the NAV file into fund_data. Returns the new state; done when `pass` is gone. */
export async function catalogStep(db: Database, state: CatalogState, chunkBytes = CHUNK_BYTES): Promise<CatalogState> {
  const pass = state.pass ?? { startedAt: new Date().toISOString(), etag: '', offset: 0, cursor: START, matched: 0 };
  const response = await get(AMFI_URL, { headers: { range: `bytes=${pass.offset}-${pass.offset + chunkBytes - 1}` } });
  const etag = response.headers.get('etag') ?? '';
  const total = Number(response.headers.get('content-range')?.split('/')[1]);
  const bytes = new Uint8Array(await response.arrayBuffer());

  if (response.status !== 206 || !Number.isFinite(total)) {
    throw new Error(`AMFI ignored the range request (status ${response.status})`);
  }
  if (pass.etag && etag !== pass.etag) {
    return { ...state, pass: undefined }; // the file changed mid-pass; the next run starts over
  }

  const isLast = pass.offset + bytes.length >= total;
  const { text, used } = wholeLines(bytes, isLast);
  if (used === 0) throw new Error('AMFI chunk held no complete line');
  const { schemes, cursor } = parseLines(text, pass.cursor);

  const seenAt = new Date(pass.startedAt);
  const rows = schemes.flatMap((s) => {
    const categoryId = categoryOf(s.heading, s.name);
    if (!categoryId || !isDirectGrowth(s.name, s.plan, s.option)) return [];
    return [{ schemeCode: s.code, name: s.name, fundHouse: s.fundHouse, categoryId, navDate: s.navDate, seenAt }];
  });
  if (rows.length) {
    await db
      .insert(fundData)
      .values(rows)
      .onConflictDoUpdate({
        target: fundData.schemeCode,
        set: {
          fundHouse: sql`excluded.fund_house`,
          categoryId: sql`excluded.category_id`,
          navDate: sql`excluded.nav_date`,
          seenAt: sql`excluded.seen_at`,
        },
      });
  }

  const matched = pass.matched + rows.length;
  if (isLast) return { completedAt: pass.startedAt, completedFunds: matched };
  return { ...state, pass: { ...pass, etag, offset: pass.offset + used, cursor, matched } };
}

/**
 * The screener's funds in a category: listed in the last complete pass, with a
 * NAV no more than a week older than the newest (older means wound down or merged).
 */
export async function activeInCategory(db: Database, completedAt: string | undefined, categoryId?: string) {
  if (!completedAt) return [];
  const listed = and(gte(fundData.seenAt, new Date(completedAt)), sql`${fundData.categoryId} is not null`);
  const [newest] = await db
    .select({ d: sql<string | null>`max(${fundData.navDate})` })
    .from(fundData)
    .where(listed);
  if (!newest?.d) return [];
  const activeSince = isoDate(Date.parse(`${newest.d}T00:00:00Z`) - 7 * DAY_MS);
  return db
    .select()
    .from(fundData)
    .where(
      and(listed, gte(fundData.navDate, activeSince), categoryId ? eq(fundData.categoryId, categoryId) : undefined),
    )
    .orderBy(fundData.name);
}

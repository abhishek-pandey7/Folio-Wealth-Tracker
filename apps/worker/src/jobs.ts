// Scheduled work. One cron trigger fires every minute and runs the single most
// urgent job, so every invocation stays small: a few upstream calls and a few
// milliseconds of CPU, inside the free plan's limits. Each job finds its own
// work from data age, so a failed run is simply retried by a later one.

import { type Database, InstrumentsService, type Logger, SipsService, schema } from '@folio/core';
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { DEMO_SYMBOLS, demoSeeded, resetDemo } from './demo.js';
import { HOUR, MINUTE } from './market/cache.js';
import { CATALOG_JOB, EdgeMarket } from './market/edge.js';
import { type CatalogState, catalogStep, FUNDS_BATCH, refreshFunds } from './market/funds.js';
import { refreshQuotes, refreshStats, STATS_BATCH, track } from './market/stocks.js';
import { allSymbols, curatedSymbols } from './market/universe.js';

const { symbolData, fundData, jobState, instruments } = schema;

/** A refresh that failed for the symbol itself (delisted, unknown) waits this long before a retry. */
const ERROR_BACKOFF_MS = 6 * HOUR;
const STATS_MAX_AGE_MS = 3 * HOUR;
/**
 * Nifty 500 and S&P 500 members that are not curated, held or starred: their
 * one-year-and-longer statistics barely move in a day, and refreshing about a
 * thousand of them every 3 hours would not fit one small job a minute.
 */
const INDEX_STATS_MAX_AGE_MS = 24 * HOUR;
const FUND_MAX_AGE_MS = 12 * HOUR;
/** SIP instalments are recorded once NAVs are out: AMFI publishes by about 23:00 IST (17:30 UTC). */
const SIP_HOUR_UTC = 19;
/** The public demo is put back at 02:30 IST, when nobody is likely to be mid-visit. */
const DEMO_RESET_HOUR_UTC = 21;
const CATALOG_HOUR_UTC = 18;

/** Either exchange trading (NSE 03:45–10:00 UTC, NYSE 13:30–20:00 UTC on weekdays) means quotes move. */
export function marketsOpen(now: Date): boolean {
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return (minutes >= 225 && minutes <= 600) || (minutes >= 810 && minutes <= 1200);
}

interface Job {
  name: string;
  /** Does the work if there is any; returns a short report, or null when there was nothing to do. */
  run(now: Date): Promise<Record<string, unknown> | null>;
}

const olderThan = (col: PgColumn, ms: number, now: Date) => or(isNull(col), lt(col, new Date(now.getTime() - ms)));
const notFailing = (col: PgColumn, now: Date) => or(isNull(col), lt(col, new Date(now.getTime() - ERROR_BACKOFF_MS)));

/**
 * Symbols refreshed often: the curated lists, and anything someone holds, has
 * synced from a broker or starred (every one of those has a row in
 * instruments). Everything else is on the slower index schedule.
 */
export const prioritySymbols = (): SQL =>
  or(
    inArray(symbolData.symbol, curatedSymbols()),
    sql`exists (select 1 from ${instruments} where ${instruments.symbol} = ${symbolData.symbol})`,
  ) as SQL;

/** Symbols in `tier` (all when undefined) whose quote is older than maxAgeMs, oldest first. */
export async function dueForQuotes(db: Database, tier: SQL | undefined, maxAgeMs: number, now: Date, limit = 100) {
  const rows = await db
    .select({ symbol: symbolData.symbol })
    .from(symbolData)
    .where(and(tier, isNotNull(symbolData.currency), olderThan(symbolData.quoteAt, maxAgeMs, now)))
    .orderBy(sql`${symbolData.quoteAt} asc nulls first`)
    .limit(limit);
  return rows.map((r) => r.symbol);
}

/** Symbols in `tier` (all when undefined) whose statistics are older than maxAgeMs and not failing, oldest first. */
export async function dueForStats(
  db: Database,
  tier: SQL | undefined,
  maxAgeMs: number,
  now: Date,
  limit = STATS_BATCH,
) {
  const rows = await db
    .select({ symbol: symbolData.symbol })
    .from(symbolData)
    .where(and(tier, olderThan(symbolData.statsAt, maxAgeMs, now), notFailing(symbolData.errorAt, now)))
    .orderBy(sql`${symbolData.statsAt} asc nulls first`)
    .limit(limit);
  return rows.map((r) => r.symbol);
}

export function jobs(db: Database, logger: Logger, defer: (p: Promise<unknown>) => void): Job[] {
  const market = new EdgeMarket(db, defer);
  const quotesDue = async (tier: SQL | undefined, maxAge: number, now: Date) => {
    const due = await dueForQuotes(db, tier, maxAge, now);
    return due.length ? { refreshed: await refreshQuotes(db, due), due: due.length } : null;
  };
  const statsDue = async (tier: SQL | undefined, maxAge: number, now: Date) => {
    const due = await dueForStats(db, tier, maxAge, now);
    return due.length ? refreshStats(db, due) : null;
  };

  return [
    {
      name: 'sips',
      async run(now) {
        const today = now.toISOString().slice(0, 10);
        const state = await getState<{ lastDate?: string }>(db, 'sips');
        if (now.getUTCHours() < SIP_HOUR_UTC || state.lastDate === today) return null;
        const sips = new SipsService(db, new InstrumentsService(db, market), market, logger);
        const result = await sips.runAll();
        await setState(db, 'sips', { lastDate: today });
        return result;
      },
    },
    {
      name: 'demo',
      async run(now) {
        // Seeds the public demo as soon as its symbols are priced, then puts it back every night.
        const today = now.toISOString().slice(0, 10);
        const state = await getState<{ lastReset?: string }>(db, 'demo');
        const nightly = now.getUTCHours() >= DEMO_RESET_HOUR_UTC && state.lastReset !== today;
        if (!nightly && (await demoSeeded(db))) return null;
        const priced = await db
          .select({ symbol: symbolData.symbol })
          .from(symbolData)
          .where(and(inArray(symbolData.symbol, DEMO_SYMBOLS), isNotNull(symbolData.stats)));
        if (priced.length < DEMO_SYMBOLS.length) return null; // the stocks job will get there
        const result = await resetDemo(db, market, logger);
        await setState(db, 'demo', { lastReset: today });
        return result;
      },
    },
    {
      name: 'quotes',
      run: (now) => quotesDue(prioritySymbols(), marketsOpen(now) ? 10 * MINUTE : HOUR, now),
    },
    {
      name: 'stocks',
      async run(now) {
        // New listed symbols (curated or index members) get a row, so the queues pick them up.
        const listed = allSymbols();
        const state = await getState<{ seeded?: string }>(db, 'stocks');
        const version = String(listed.length) + listed.join().length;
        if (state.seeded !== version) {
          await track(db, listed);
          await setState(db, 'stocks', { seeded: version });
        }
        return statsDue(prioritySymbols(), STATS_MAX_AGE_MS, now);
      },
    },
    {
      name: CATALOG_JOB,
      async run(now) {
        const state = await getState<CatalogState>(db, CATALOG_JOB);
        const today = now.toISOString().slice(0, 10);
        const fresh =
          state.completedAt && (state.completedAt.slice(0, 10) === today || now.getUTCHours() < CATALOG_HOUR_UTC);
        if (!state.pass && fresh) return null;
        const next = await catalogStep(db, state);
        await setState(db, CATALOG_JOB, next as Record<string, unknown>);
        return next.pass
          ? { offset: next.pass.offset, matched: next.pass.matched }
          : { completed: next.completedFunds };
      },
    },
    {
      name: 'funds',
      async run(now) {
        const { completedAt } = await getState<CatalogState>(db, CATALOG_JOB);
        const listed = completedAt
          ? and(isNotNull(fundData.categoryId), gte(fundData.seenAt, new Date(completedAt)))
          : sql`false`;
        const due = await db
          .select({ code: fundData.schemeCode })
          .from(fundData)
          .where(
            and(
              or(listed, isNotNull(fundData.stats)),
              olderThan(fundData.statsAt, FUND_MAX_AGE_MS, now),
              notFailing(fundData.errorAt, now),
            ),
          )
          .orderBy(sql`${fundData.statsAt} asc nulls first`, asc(fundData.schemeCode))
          .limit(FUNDS_BATCH);
        if (due.length === 0) return null;
        return refreshFunds(
          db,
          due.map((r) => r.code),
        );
      },
    },
    // Last, so loading about a thousand index members never holds up the jobs above.
    {
      name: 'index-quotes',
      run: (now) => quotesDue(undefined, marketsOpen(now) ? HOUR : 6 * HOUR, now),
    },
    {
      name: 'index-stocks',
      run: (now) => statsDue(undefined, INDEX_STATS_MAX_AGE_MS, now),
    },
  ];
}

/** A job that failed is skipped this long, so a broken provider cannot starve the jobs after it. */
const FAILURE_BACKOFF_MS = 5 * MINUTE;

/** Runs the first job, in priority order, that has work. */
export async function runDue(
  db: Database,
  logger: Logger,
  defer: (p: Promise<unknown>) => void,
  now = new Date(),
): Promise<{ job: string; report: Record<string, unknown> } | null> {
  const retryAt = new Map(
    (await db.select({ name: jobState.name, report: jobState.report }).from(jobState)).map((r) => [
      r.name,
      r.report?.retryAt as string | undefined,
    ]),
  );
  for (const job of jobs(db, logger, defer)) {
    const retry = retryAt.get(job.name);
    if (retry && Date.parse(retry) > now.getTime()) continue;
    const started = Date.now();
    let report: Record<string, unknown> | null;
    try {
      report = await job.run(now);
    } catch (error) {
      logger.warn(`Job ${job.name} failed: ${(error as Error).message}`);
      report = { error: (error as Error).message, retryAt: new Date(now.getTime() + FAILURE_BACKOFF_MS).toISOString() };
    }
    if (report === null) continue;
    const entry = { ...report, ranAt: now.toISOString(), durationMs: Date.now() - started };
    await db
      .insert(jobState)
      .values({ name: job.name, report: entry })
      .onConflictDoUpdate({ target: jobState.name, set: { report: entry, updatedAt: new Date() } });
    return { job: job.name, report: entry };
  }
  return null;
}

async function getState<T>(db: Database, name: string): Promise<T> {
  const [row] = await db.select({ state: jobState.state }).from(jobState).where(eq(jobState.name, name));
  return (row?.state ?? {}) as T;
}

async function setState(db: Database, name: string, state: Record<string, unknown>): Promise<void> {
  await db
    .insert(jobState)
    .values({ name, state })
    .onConflictDoUpdate({ target: jobState.name, set: { state, updatedAt: new Date() } });
}

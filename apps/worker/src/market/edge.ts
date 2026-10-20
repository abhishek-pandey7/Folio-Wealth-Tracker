// Market data on Workers. Requests read what cron jobs precomputed into
// Postgres and fetch inline only what is missing, within a request's budget of
// 50 upstream calls and 10 ms of CPU. Same JSON contracts as the Go gateway.

import { BadRequestError, type Database, type MarketData, NotFoundError, schema } from '@folio/core';
import {
  type BatchQuotes,
  type Fund,
  type FundCategory,
  type FundMatch,
  type FundScreenResult,
  type FundStats,
  type FxRate,
  HistoryRangeSchema,
  type NavOn,
  type PriceHistory,
  type Quote,
  type ScreenResult,
  type ScreenRow,
  type SymbolMatch,
  SymbolSchema,
  type SymbolStats,
  type Universe,
} from '@folio/shared';
import { eq } from 'drizzle-orm';
import { isoDate, toDate } from './analytics.js';
import { type CachePolicy, cached, type Defer, HOUR, MINUTE } from './cache.js';
import { activeInCategory, type CatalogState, FUNDS_BATCH, readFunds, refreshFunds } from './funds.js';
import * as mfapi from './mfapi.js';
import { MAX_LIST, parseScreen, rank, type ScreenParams } from './screen.js';
import {
  readSymbols,
  refreshStats,
  STATS_BATCH,
  type SymbolRow,
  storeIdentities,
  storeQuotes,
  track,
} from './stocks.js';
import { fundCategories, fundCategory, universe, universes } from './universe.js';
import { decimal, getJson } from './upstream.js';
import * as yahoo from './yahoo.js';

const DAY_MS = 86_400_000;
/** A quote older than this is refreshed before being served alone (the quote job runs every 10 minutes). */
const QUOTE_FRESH_MS = 15 * MINUTE;
/** Quotes loaded inline per request, one small chart call each (a request may make 50 upstream calls). */
const INLINE_SYMBOLS = 20;
/** Statistics loaded inline per request: the same CPU budget as a job run. The cron job loads the rest. */
const INLINE_STATS = STATS_BATCH;
const INLINE_FUNDS = FUNDS_BATCH;
const MAX_NAV_DATES = 400;
/** A NAV published up to this long after a requested date still counts for it (holidays, long weekends). */
const NAV_SETTLE_MS = 10 * DAY_MS;

const policies = {
  history: { ttlMs: HOUR, staleMs: 24 * HOUR },
  search: { ttlMs: 24 * HOUR, staleMs: 7 * 24 * HOUR },
  fx: { ttlMs: HOUR, staleMs: 72 * HOUR },
  fund: { ttlMs: HOUR, staleMs: 72 * HOUR },
  fundHistory: { ttlMs: 6 * HOUR, staleMs: 72 * HOUR },
} satisfies Record<string, CachePolicy>;

export const CATALOG_JOB = 'fund-catalog';

function parseSymbol(raw: string): string {
  const parsed = SymbolSchema.safeParse(raw);
  if (!parsed.success) throw new BadRequestError(`Invalid ticker symbol "${raw.trim()}"`);
  return parsed.data;
}

function parseSchemeCode(raw: string): string {
  const code = raw.trim();
  if (!/^\d{1,8}$/.test(code)) throw new BadRequestError(`Invalid mutual fund scheme code "${code}"`);
  return code;
}

function parseQuery(raw: string): string {
  const q = raw.trim();
  if (q.length < 2 || q.length > 64) throw new BadRequestError('Search query must be 2 to 64 characters');
  return q;
}

function parseRange(raw: string | undefined) {
  const parsed = HistoryRangeSchema.safeParse(raw || '1y');
  if (!parsed.success) throw new BadRequestError('range must be one of 1mo, 3mo, 6mo, 1y, 5y');
  return parsed.data;
}

const RANGE_YEARS = { '1mo': 1 / 12, '3mo': 0.25, '6mo': 0.5, '1y': 1, '5y': 5 } as const;

/** Today's live move replaces the 1-day return from daily closes, which may be a day behind. */
function withQuote(stats: SymbolStats, quote: Quote | null): ScreenRow {
  if (!quote) return { ...stats, changePercent: null };
  const pct = Number(quote.changePercent);
  return {
    ...stats,
    price: quote.price,
    changePercent: pct,
    metrics: { ...stats.metrics, returns: { ...stats.metrics.returns, '1d': pct } },
  };
}

export class EdgeMarket implements MarketData {
  constructor(
    private readonly db: Database,
    private readonly defer: Defer,
  ) {}

  // Stocks.

  async quote(rawSymbol: string): Promise<Quote> {
    const symbol = parseSymbol(rawSymbol);
    const row = (await readSymbols(this.db, [symbol])).get(symbol);
    if (row?.quote && row.quoteAt && Date.now() - row.quoteAt.getTime() < QUOTE_FRESH_MS) return row.quote;
    try {
      const chart = await yahoo.chart(symbol);
      const quote = { ...chart.quote, symbol };
      await storeIdentities(this.db, [{ ...chart.identity, symbol }]);
      await storeQuotes(this.db, [quote]);
      return quote;
    } catch (error) {
      if (row?.quote) return { ...row.quote, stale: true };
      throw error;
    }
  }

  async quotes(rawSymbols: string[]): Promise<BatchQuotes> {
    if (rawSymbols.length === 0) throw new BadRequestError('At least one symbol is required');
    if (rawSymbols.length > MAX_LIST) throw new BadRequestError(`At most ${MAX_LIST} symbols per request`);
    const errors: Record<string, string> = {};
    const symbols = this.parseList(rawSymbols, errors);
    const rows = await readSymbols(this.db, symbols);
    const missing = symbols.filter((s) => !rows.get(s)?.quote);
    const loaded = await Promise.all(
      missing.slice(0, INLINE_SYMBOLS).map((s) =>
        this.quote(s).then(
          (q) => [s, q] as const,
          (e: unknown) => {
            errors[s] = (e as Error).message;
            return undefined;
          },
        ),
      ),
    );
    const fresh = new Map(loaded.flatMap((x) => (x ? [x] : [])));
    for (const s of missing.slice(INLINE_SYMBOLS)) errors[s] = 'Not loaded yet; try again in a minute';
    await track(this.db, missing.slice(INLINE_SYMBOLS));
    return {
      quotes: symbols.flatMap((s) => {
        const q = fresh.get(s) ?? rows.get(s)?.quote;
        return q ? [q] : [];
      }),
      errors,
    };
  }

  async history(rawSymbol: string, rawRange?: string): Promise<PriceHistory> {
    const symbol = parseSymbol(rawSymbol);
    const range = parseRange(rawRange);
    const { value } = await cached(this.db, this.defer, `history:${symbol}:${range}`, policies.history, async () => {
      const chart = await yahoo.chart(symbol, range, yahoo.HISTORY_INTERVAL[range]);
      return {
        symbol: chart.identity.symbol,
        currency: chart.identity.currency,
        range,
        interval: yahoo.HISTORY_INTERVAL[range],
        points: chart.points.map((p) => ({ date: p.date, close: decimal(p.close) })),
        source: 'yahoo',
      } satisfies PriceHistory;
    });
    return value;
  }

  async search(rawQuery: string): Promise<SymbolMatch[]> {
    const q = parseQuery(rawQuery);
    return (await cached(this.db, this.defer, `search:${q.toLowerCase()}`, policies.search, () => yahoo.search(q)))
      .value;
  }

  async fx(rawBase = 'USD', rawQuote = 'INR'): Promise<FxRate> {
    const base = rawBase.trim().toUpperCase();
    const quote = rawQuote.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(base) || !/^[A-Z]{3}$/.test(quote)) throw new BadRequestError('Invalid currency code');
    if (base === quote) return { base, quote, rate: '1', date: isoDate(Date.now()), source: 'identity', stale: false };
    const { value, stale } = await cached(this.db, this.defer, `fx:${base}:${quote}`, policies.fx, async () => {
      const res = await getJson<{ date: string; rates: Record<string, number> }>(
        `https://api.frankfurter.dev/v1/latest?base=${base}&symbols=${quote}`,
      );
      const rate = res.rates[quote];
      if (rate === undefined) throw new NotFoundError(`No ${base}/${quote} rate`);
      return { base, quote, rate: String(rate), date: res.date, source: 'frankfurter', stale: false } satisfies FxRate;
    });
    return { ...value, stale };
  }

  async usdInr(): Promise<string> {
    return (await this.fx('USD', 'INR')).rate;
  }

  universes(): Universe[] {
    return universes();
  }

  async stats(rawSymbol: string): Promise<SymbolStats> {
    const symbol = parseSymbol(rawSymbol);
    const row = (await this.ensureStats([symbol])).get(symbol);
    if (!row?.stats) throw new NotFoundError(row?.error ?? `No statistics for ${symbol}`);
    return row.stats;
  }

  async screen(q: ScreenParams & { universe?: string; symbols?: string[] }): Promise<ScreenResult> {
    const s = parseScreen(q, '1y');
    const unavailable: Record<string, string> = {};
    let symbols: string[];
    let found: Universe | null = null;
    if (q.universe) {
      const u = universe(q.universe);
      if (!u) throw new NotFoundError(`No universe "${q.universe}"`);
      found = u.universe;
      symbols = u.symbols;
    } else if (q.symbols?.length) {
      if (q.symbols.length > MAX_LIST) throw new BadRequestError(`At most ${MAX_LIST} symbols per screen`);
      symbols = this.parseList(q.symbols, unavailable);
    } else {
      throw new BadRequestError('universe or symbols is required');
    }

    // Curated universes are kept warm by the cron job; an explicit list (a
    // user's starred symbols) may include anything, so it loads what is missing.
    const rows = q.universe ? await readSymbols(this.db, symbols) : await this.ensureStats(symbols);
    const out: ScreenRow[] = [];
    for (const sym of symbols) {
      const row = rows.get(sym);
      if (row?.stats) out.push(withQuote(row.stats, row.quote));
      else unavailable[sym] = row?.error ?? 'Statistics are still loading; try again in a few minutes';
    }
    rank(out, (r) => r.symbol, s);
    return { universe: found, ...s, total: out.length, rows: out.slice(0, s.limit), unavailable };
  }

  /** Portfolio pricing: statistics plus the live quote for each symbol held. */
  async priceSymbols(symbols: string[]): Promise<ScreenRow[]> {
    const rows = await this.ensureStats(symbols);
    return symbols.flatMap((s) => {
      const row = rows.get(s);
      return row?.stats ? [withQuote(row.stats, row.quote)] : [];
    });
  }

  /** Rows for these symbols, loading statistics inline for those that have none yet. */
  private async ensureStats(symbols: string[]): Promise<Map<string, SymbolRow>> {
    let rows = await readSymbols(this.db, symbols);
    const missing = symbols.filter((s) => !rows.get(s)?.stats && !rows.get(s)?.error);
    if (missing.length) {
      await refreshStats(this.db, missing.slice(0, INLINE_STATS));
      await track(this.db, missing.slice(INLINE_STATS));
      rows = await readSymbols(this.db, symbols);
    }
    return rows;
  }

  // Mutual funds.

  async fund(rawCode: string): Promise<Fund> {
    const code = parseSchemeCode(rawCode);
    const { value, stale } = await cached(this.db, this.defer, `fund:${code}`, policies.fund, () => mfapi.latest(code));
    return { ...value, stale };
  }

  async searchFunds(rawQuery: string): Promise<FundMatch[]> {
    const q = parseQuery(rawQuery);
    return (
      await cached(this.db, this.defer, `fund-search:${q.toLowerCase()}`, policies.search, () => mfapi.searchFunds(q))
    ).value;
  }

  async fundCategories(): Promise<FundCategory[]> {
    const counts = new Map<string, number>();
    for (const row of await activeInCategory(this.db, await this.catalogCompletedAt())) {
      counts.set(row.categoryId as string, (counts.get(row.categoryId as string) ?? 0) + 1);
    }
    return fundCategories().map((c) => ({ ...c, count: counts.get(c.id) ?? 0 }));
  }

  async fundStats(rawCode: string): Promise<FundStats> {
    const code = parseSchemeCode(rawCode);
    const row = (await this.ensureFunds([code])).get(code);
    if (!row?.stats) throw new NotFoundError(row?.error ?? `No statistics for fund ${code}`);
    return row.stats;
  }

  async fundScreen(q: ScreenParams & { category?: string; codes?: string[] }): Promise<FundScreenResult> {
    // Funds are long-term holdings, so the default comparison is 3-year annualized.
    const s = parseScreen(q, '3y');
    const unavailable: Record<string, string> = {};
    let rows: { schemeCode: string; stats: FundStats | null; error: string | null }[];
    let category: FundCategory | null = null;
    if (q.category) {
      const c = fundCategory(q.category);
      if (!c) throw new NotFoundError(`No fund category "${q.category}"`);
      rows = await activeInCategory(this.db, await this.catalogCompletedAt(), c.id);
      category = { ...c, count: rows.length };
    } else if (q.codes?.length) {
      if (q.codes.length > MAX_LIST) throw new BadRequestError(`At most ${MAX_LIST} funds per screen`);
      const codes = [
        ...new Set(
          q.codes.flatMap((raw) => {
            try {
              return [parseSchemeCode(raw)];
            } catch (e) {
              unavailable[raw.trim()] = (e as Error).message;
              return [];
            }
          }),
        ),
      ];
      const found = await this.ensureFunds(codes);
      rows = codes.map((code) => found.get(code) ?? { schemeCode: code, stats: null, error: null });
    } else {
      throw new BadRequestError('category or codes is required');
    }

    const out: FundStats[] = [];
    for (const row of rows) {
      if (row.stats) out.push(row.stats);
      else unavailable[row.schemeCode] = row.error ?? 'Statistics are still loading; try again in a few minutes';
    }
    rank(out, (r) => r.schemeCode, s);
    return { category, ...s, total: out.length, rows: out.slice(0, s.limit), unavailable };
  }

  async priceFunds(codes: string[]): Promise<FundStats[]> {
    const rows = await this.ensureFunds(codes);
    return codes.flatMap((c) => {
      const stats = rows.get(c)?.stats;
      return stats ? [stats] : [];
    });
  }

  async fundHistory(rawCode: string, rawRange?: string): Promise<PriceHistory> {
    const code = parseSchemeCode(rawCode);
    const range = parseRange(rawRange);
    const { value } = await cached(
      this.db,
      this.defer,
      `fund-history:${code}:${range}`,
      policies.fundHistory,
      async () => {
        const from = isoDate(Date.now() - RANGE_YEARS[range] * 365.25 * DAY_MS);
        const series = await mfapi.navs(code, from, isoDate(Date.now()));
        // Thin five years of daily NAVs to one point a week, like stock charts.
        const weekly = range === '5y';
        const points: PriceHistory['points'] = [];
        let lastWeek = -1;
        for (const p of series.points) {
          const week = Math.floor((p.date / DAY_MS + 3) / 7); // ISO weeks start on Monday
          if (weekly && week === lastWeek) points.pop();
          lastWeek = week;
          points.push({ date: isoDate(p.date), close: decimal(p.value, 6) });
        }
        return {
          symbol: code,
          currency: 'INR',
          range,
          interval: yahoo.HISTORY_INTERVAL[range],
          points,
          source: 'mfapi',
        } satisfies PriceHistory;
      },
    );
    return value;
  }

  /**
   * For each requested date, the first NAV published on or after it: a SIP due
   * on a holiday is bought at the next business day's NAV. Dates whose NAV is
   * not out yet are left out so a later run can record them.
   */
  async navsOn(rawCode: string, rawDates: string[]): Promise<NavOn[]> {
    const code = parseSchemeCode(rawCode);
    if (rawDates.length === 0 || rawDates.length > MAX_NAV_DATES) {
      throw new BadRequestError(`Between 1 and ${MAX_NAV_DATES} dates are required`);
    }
    const dates = rawDates.map((raw) => {
      const d = toDate(raw.trim());
      if (Number.isNaN(d) || !/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
        throw new BadRequestError(`"${raw}" is not a YYYY-MM-DD date`);
      }
      return d;
    });
    const from = isoDate(Math.min(...dates));
    const to = isoDate(Math.min(Math.max(...dates) + NAV_SETTLE_MS, Date.now()));
    const { points } = await mfapi.navs(code, from, to);

    return dates.flatMap((d) => {
      const p = points.find((x) => x.date >= d);
      if (!p || p.date - d > NAV_SETTLE_MS) return [];
      return [{ requested: isoDate(d), date: isoDate(p.date), nav: decimal(p.value, 6) }];
    });
  }

  private async ensureFunds(codes: string[]) {
    let rows = await readFunds(this.db, codes);
    const missing = codes.filter((c) => !rows.get(c)?.stats && !rows.get(c)?.error);
    if (missing.length) {
      await refreshFunds(this.db, missing.slice(0, INLINE_FUNDS));
      rows = await readFunds(this.db, codes);
    }
    return rows;
  }

  private async catalogCompletedAt(): Promise<string | undefined> {
    const [row] = await this.db
      .select({ state: schema.jobState.state })
      .from(schema.jobState)
      .where(eq(schema.jobState.name, CATALOG_JOB));
    return (row?.state as CatalogState | undefined)?.completedAt;
  }

  private parseList(raw: string[], errors: Record<string, string>): string[] {
    const out = new Set<string>();
    for (const r of raw) {
      try {
        out.add(parseSymbol(r));
      } catch (e) {
        errors[r.trim()] = (e as Error).message;
      }
    }
    return [...out];
  }
}

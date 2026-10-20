import { type Database, schema } from '@folio/core';
import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EdgeMarket } from './edge.js';
import { activeInCategory, type CatalogState, catalogStep, refreshFunds } from './funds.js';

const databaseUrl = process.env.DATABASE_URL;

// Upstreams are faked at the fetch level, so the real parsing, storage and
// ranking code runs against Postgres with no network.

const tag = Math.floor(Math.random() * 1e6)
  .toString()
  .padStart(6, '0');
const FAST = `TA${tag}.NS`; // grows 30% a year
const SLOW = `TB${tag}.NS`; // grows 5% a year
const UNKNOWN = `TZ${tag}.NS`;
const FUND = `9${tag}1`;
const FUND_IDCW = `9${tag}2`;
const FUND_OTHER = `9${tag}3`;

const DAY = 86_400_000;
const END = Date.UTC(2026, 9, 19);

/** Weekday closes for five years, growing at `rate` a year. */
function series(rate: number) {
  const ts: number[] = [];
  const close: number[] = [];
  for (let d = END - 5 * 365 * DAY; d <= END; d += DAY) {
    const wd = new Date(d).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    ts.push(d / 1000 + 4 * 3600);
    close.push(100 * (1 + rate) ** ((d - (END - 5 * 365 * DAY)) / DAY / 365.25));
  }
  return { ts, close };
}

const amfiFile = () =>
  'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date\r\n' +
  'Open Ended Schemes(Equity Scheme - Flexi Cap Fund)\r\n\r\nTest Mutual Fund\r\n' +
  `${FUND};X;-;Test Flexi Cap Fund;Direct Plan;Growth Option;50.00;19-Oct-2026\r\n` +
  `${FUND_IDCW};X;-;Test Flexi Cap Fund;Direct Plan;IDCW Option;20.00;19-Oct-2026\r\n` +
  'Open Ended Schemes(Equity Scheme - Sectoral/ Thematic)\r\nTest Mutual Fund\r\n' +
  `${FUND_OTHER};X;-;Test Theme Fund;Direct Plan;Growth Option;10.00;19-Oct-2026\r\n`;

let etag = '"v1"';
let fetches = 0;

async function fakeFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  fetches++;
  const url = new URL(String(input));
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  if (url.pathname.startsWith('/v8/finance/chart/')) {
    const symbol = decodeURIComponent(url.pathname.split('/').at(-1) ?? '');
    if (symbol !== FAST && symbol !== SLOW) return json({ chart: { result: null } }, 404);
    const { ts, close } = series(symbol === FAST ? 0.3 : 0.05);
    return json({
      chart: {
        result: [
          {
            meta: {
              symbol,
              currency: 'INR',
              longName: `${symbol} Ltd`,
              fullExchangeName: 'NSE',
              regularMarketPrice: close.at(-1),
              chartPreviousClose: close.at(-2),
              regularMarketTime: ts.at(-1),
            },
            timestamp: ts,
            // Dividends: adjusted closes sit below plain closes in the past.
            indicators: { quote: [{ close: close.map((c) => c * 1.02) }], adjclose: [{ adjclose: close }] },
          },
        ],
      },
    });
  }
  if (url.pathname === '/v8/finance/spark') {
    const out: Record<string, unknown> = {};
    for (const s of url.searchParams.get('symbols')?.split(',') ?? []) {
      out[s] = { symbol: s, timestamp: [END / 1000], close: [110], chartPreviousClose: 100 };
    }
    return json(out);
  }
  if (url.host === 'api.mfapi.in') {
    const code = url.pathname.split('/')[2];
    const { ts, close } = series(0.12);
    return json({
      meta: {
        fund_house: 'Test Mutual Fund',
        scheme_category: 'Equity Scheme - Flexi Cap Fund',
        scheme_name: `Fund ${code}`,
      },
      data: ts
        .map((t, i) => {
          const d = new Date(t * 1000).toISOString().slice(0, 10).split('-').reverse().join('-');
          return { date: d, nav: (close[i] as number).toFixed(4) };
        })
        .reverse(),
    });
  }
  if (url.host === 'portal.amfiindia.com') {
    const bytes = new TextEncoder().encode(amfiFile());
    const [from, to] = (new Headers(init?.headers).get('range') ?? '').replace('bytes=', '').split('-').map(Number);
    const slice = bytes.subarray(from, Math.min((to as number) + 1, bytes.length));
    return new Response(slice, {
      status: 206,
      headers: { etag, 'content-range': `bytes ${from}-${(from as number) + slice.length - 1}/${bytes.length}` },
    });
  }
  throw new Error(`unexpected fetch ${url}`);
}

describe.skipIf(!databaseUrl)('edge market data (Postgres)', () => {
  let client: Client;
  let db: Database;
  let market: EdgeMarket;

  beforeAll(async () => {
    vi.stubGlobal('fetch', fakeFetch);
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    db = drizzle({ client, schema });
    market = new EdgeMarket(db, () => {});
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await db.delete(schema.symbolData).where(inArray(schema.symbolData.symbol, [FAST, SLOW, UNKNOWN]));
    await db.delete(schema.fundData).where(inArray(schema.fundData.schemeCode, [FUND, FUND_IDCW, FUND_OTHER]));
    await client.end();
  });

  it('loads missing statistics inline, from dividend-adjusted closes, and ranks them', async () => {
    const result = await market.screen({ symbols: [SLOW, FAST, 'not a symbol'], period: '3y' });

    expect(result.rows.map((r) => r.symbol)).toEqual([FAST, SLOW]);
    const fast = result.rows[0];
    expect(fast?.metrics.returns['3y']).toBeCloseTo(30, 0); // the adjusted series, not the plain closes
    expect(fast).toMatchObject({ name: `${FAST} Ltd`, exchange: 'NSE', currency: 'INR', changePercent: 10 });
    expect(fast?.metrics.returns['1d']).toBe(10); // the live quote replaces the daily close
    expect(result.unavailable['not a symbol']).toMatch(/Invalid ticker/);
  });

  it('serves stored statistics without calling the provider again', async () => {
    const before = fetches;
    const stats = await market.stats(SLOW);
    expect(stats.metrics.returns['5y']).toBeCloseTo(5, 0);
    expect(fetches).toBe(before);
  });

  it('records an unknown symbol once instead of retrying it on every request', async () => {
    const first = await market.screen({ symbols: [UNKNOWN] });
    expect(first.unavailable[UNKNOWN]).toBeDefined();
    const before = fetches;
    const second = await market.screen({ symbols: [UNKNOWN] });
    expect(second.unavailable[UNKNOWN]).toBe(first.unavailable[UNKNOWN]);
    expect(fetches).toBe(before);
  });

  it('reads the AMFI file in chunks into the fund catalogue', async () => {
    let state: CatalogState = {};
    let steps = 0;
    do {
      state = await catalogStep(db, state, 120);
      steps++;
    } while (state.pass);

    expect(steps).toBeGreaterThan(3);
    expect(state.completedFunds).toBe(1); // IDCW and off-category schemes are skipped
    const flexi = await activeInCategory(db, state.completedAt, 'flexi-cap');
    expect(flexi.map((f) => f.schemeCode)).toContain(FUND);
    expect(flexi.map((f) => f.schemeCode)).not.toContain(FUND_IDCW);
  });

  it('starts the pass over when the file changes underneath it', async () => {
    const started = await catalogStep(db, {}, 120);
    expect(started.pass?.offset).toBeGreaterThan(0);
    etag = '"v2"';
    const after = await catalogStep(db, started, 120);
    expect(after.pass).toBeUndefined();
    expect(after.completedAt).toBeUndefined();
    etag = '"v1"';
  });

  it('computes fund statistics and screens funds by code', async () => {
    expect(await refreshFunds(db, [FUND])).toEqual({ refreshed: 1, failed: 0 });
    const result = await market.fundScreen({ codes: [FUND], period: '3y' });
    expect(result.rows[0]?.metrics.returns['3y']).toBeCloseTo(12, 0);
    expect(result.rows[0]?.name).toBe(`Fund ${FUND}`);
  });
});

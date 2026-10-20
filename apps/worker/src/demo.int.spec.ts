import { randomUUID } from 'node:crypto';
import { AccountsService, consoleLogger, type Database, type MarketData, schema } from '@folio/core';
import type { Metrics, SymbolStats } from '@folio/shared';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_EMAIL, DEMO_SYMBOLS, resetDemo } from './demo.js';

const databaseUrl = process.env.DATABASE_URL;

const metrics: Metrics = {
  asOf: '2026-10-19',
  returns: { '1d': 0, '1w': 1, '1m': 2, '3m': 4, '6m': 8, ytd: 9, '1y': 15, '3y': 12, '5y': 11 },
  volatility1y: 20,
  maxDrawdown1y: -10,
  riskAdjusted1y: 0.75,
  upMonths: 8,
  months: 12,
};

const usd = new Set(['AAPL', 'MSFT', 'VOO']);
const today = () => new Date().toISOString().slice(0, 10);

/** Every price 100, every NAV 50, published on the requested day. */
const market: MarketData = {
  quote: async (symbol) => ({
    symbol,
    currency: usd.has(symbol) ? 'USD' : 'INR',
    price: '100',
    change: '0',
    changePercent: '0',
    previousClose: '100',
    asOf: new Date().toISOString(),
    source: 'test',
    stale: false,
  }),
  fund: async (code) => ({
    schemeCode: code,
    name: `Fund ${code}`,
    fundHouse: 'Test',
    category: 'Test',
    nav: '50',
    navDate: today(),
    source: 'test',
    stale: false,
  }),
  priceSymbols: async () => [],
  priceFunds: async () => [],
  usdInr: async () => '90',
  navsOn: async (_code, dates) => dates.filter((d) => d <= today()).map((d) => ({ requested: d, date: d, nav: '50' })),
};

describe.skipIf(!databaseUrl)('public demo (Postgres)', () => {
  let client: Client;
  let db: Database;
  let otherUser: string;

  const countFor = async (email: string) => {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    if (!user) return null;
    const accounts = await new AccountsService(db).list(user.id);
    const ids = accounts.map((a) => a.id);
    const trades = ids.length
      ? await db.select().from(schema.transactions).where(inArray(schema.transactions.portfolioId, ids))
      : [];
    const goals = await db.select().from(schema.goals).where(eq(schema.goals.userId, user.id));
    const sips = await db.select().from(schema.sips).where(eq(schema.sips.userId, user.id));
    const stars = await db.select().from(schema.watchlistItems).where(eq(schema.watchlistItems.userId, user.id));
    return {
      accounts: accounts.length,
      trades: trades.length,
      goals: goals.length,
      sips: sips.length,
      stars: stars.length,
    };
  };

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    db = drizzle({ client, schema });
    // The seed prices trades from stored statistics; give any symbol without them some.
    await db
      .insert(schema.symbolData)
      .values(
        DEMO_SYMBOLS.map((symbol) => ({
          symbol,
          stats: {
            symbol,
            name: symbol,
            exchange: 'TEST',
            currency: usd.has(symbol) ? 'USD' : 'INR',
            sector: '',
            price: '100',
            high52w: 110,
            low52w: 80,
            fromHigh52w: -9.09,
            metrics,
          } satisfies SymbolStats,
          statsAt: new Date(),
        })),
      )
      .onConflictDoNothing();
    const [user] = await db
      .insert(schema.users)
      .values({ email: `other-${randomUUID()}@folio.test`, displayName: 'Other' })
      .returning({ id: schema.users.id });
    otherUser = user?.id as string;
    await new AccountsService(db).create(otherUser, { name: 'Untouched', currency: 'INR' });
  });

  afterAll(async () => {
    await db.delete(schema.users).where(eq(schema.users.id, otherUser));
    await client.end();
  });

  it('builds a full sample portfolio', async () => {
    const { trades } = await resetDemo(db, market, consoleLogger);
    const counts = await countFor(DEMO_EMAIL);
    expect(counts).toMatchObject({ accounts: 3, goals: 2, sips: 2, stars: 3 });
    // Buys, a sale and a dividend, plus every backfilled SIP instalment.
    expect(trades).toBeGreaterThanOrEqual(DEMO_SYMBOLS.length);
    expect(counts?.trades).toBeGreaterThan(trades + 30);
  });

  it('resets to exactly the same portfolio, however much a visitor changed', async () => {
    const before = await countFor(DEMO_EMAIL);
    const [demo] = await db.select().from(schema.users).where(eq(schema.users.email, DEMO_EMAIL));
    await new AccountsService(db).create(demo?.id as string, { name: 'Visitor was here', currency: 'INR' });

    await resetDemo(db, market, consoleLogger);
    expect(await countFor(DEMO_EMAIL)).toEqual(before);
  });

  it('never touches anyone else', async () => {
    const accounts = await new AccountsService(db).list(otherUser);
    expect(accounts.map((a) => a.name)).toEqual(['Untouched']);
  });
});

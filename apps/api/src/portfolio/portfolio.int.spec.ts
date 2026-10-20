import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../database/database.module.js';
import * as schema from '../database/schema.js';
import { InstrumentsService } from '../instruments/instruments.service.js';
import type { MarketGatewayClient } from '../market/market-gateway.client.js';
import { AccountsService } from './accounts.service.js';
import { TransactionsService } from './transactions.service.js';
import { ValuationService } from './valuation.service.js';

// Integration test: runs against a real, migrated Postgres when DATABASE_URL is set (CI provides one).
const databaseUrl = process.env.DATABASE_URL;

const run = randomUUID().slice(0, 6).toUpperCase();
const INR_STOCK = `P${run}A.NS`;
const USD_STOCK = `P${run}B`;
const UNPRICED = `P${run}C.NS`;
const FUND = String(80000000 + Math.floor(Math.random() * 999999));

const metrics = (oneDay: number) => ({
  asOf: '2026-10-19',
  returns: { '1d': oneDay, '1w': 0, '1m': 0, '3m': 0, '6m': 0, ytd: 0, '1y': 0, '3y': null, '5y': null },
  volatility1y: null,
  maxDrawdown1y: null,
  riskAdjusted1y: null,
  upMonths: 0,
  months: 0,
});

/** Stands in for the Go gateway: fixed prices so every expected number is exact. */
async function fakeGateway(path: string): Promise<unknown> {
  const [route, qs = ''] = path.split('?');
  const params = new URLSearchParams(qs);
  if (route?.startsWith('/v1/quotes/')) {
    const symbol = decodeURIComponent(route.split('/').at(-1) ?? '');
    return { symbol, currency: symbol.endsWith('.NS') ? 'INR' : 'USD', price: '100' };
  }
  if (route === '/v1/fx') {
    return { base: 'USD', quote: 'INR', rate: '90', date: '2026-10-19', source: 'test', stale: false };
  }
  if (route === '/v1/screener') {
    const rows = (params.get('symbols') ?? '')
      .split(',')
      .filter((s) => s !== UNPRICED) // simulates a symbol the gateway cannot price
      .map((symbol) => ({
        symbol,
        name: symbol,
        currency: symbol.endsWith('.NS') ? 'INR' : 'USD',
        sector: symbol.endsWith('.NS') ? 'IT services' : 'Technology',
        price: symbol.endsWith('.NS') ? '120' : '12',
        changePercent: 2,
        metrics: metrics(2),
      }));
    return { rows, unavailable: {} };
  }
  if (route === '/v1/funds/screener') {
    const rows = (params.get('codes') ?? '').split(',').map((code) => ({
      schemeCode: code,
      name: `Test Fund ${code}`,
      nav: '25',
      metrics: metrics(0.5),
    }));
    return { rows, unavailable: {} };
  }
  if (route?.startsWith('/v1/funds/')) {
    const code = route.split('/').at(-1);
    return { schemeCode: code, name: `Test Fund ${code} - Direct Plan - Growth`, nav: '25' };
  }
  throw new Error(`fake gateway has no route for ${path}`);
}

describe.skipIf(!databaseUrl)('portfolio (Postgres)', () => {
  let pool: Pool;
  let db: Database;
  let accounts: AccountsService;
  let txns: TransactionsService;
  let valuation: ValuationService;
  const userIds: string[] = [];

  async function createUser(): Promise<string> {
    const [user] = await db
      .insert(schema.users)
      .values({ email: `pf-${randomUUID()}@folio.test`, displayName: 'Test' })
      .returning({ id: schema.users.id });
    if (!user) throw new Error('user insert failed');
    userIds.push(user.id);
    return user.id;
  }

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl });
    db = drizzle({ client: pool, schema });
    const gateway = { get: fakeGateway } as unknown as MarketGatewayClient;
    accounts = new AccountsService(db);
    txns = new TransactionsService(db, accounts, new InstrumentsService(db, gateway));
    valuation = new ValuationService(db, gateway);
  });

  afterAll(async () => {
    if (userIds.length) {
      await db.delete(schema.users).where(inArray(schema.users.id, userIds)); // cascades accounts and transactions
    }
    await db
      .delete(schema.instruments)
      .where(inArray(schema.instruments.symbol, [INR_STOCK, USD_STOCK, UNPRICED, `MF-${FUND}`]));
    await pool.end();
  });

  const stock = (symbol: string) => ({ kind: 'symbol' as const, symbol });

  it('creates accounts and rejects duplicate names', async () => {
    const userId = await createUser();
    await accounts.create(userId, { name: 'Zerodha', currency: 'INR' });

    await expect(accounts.create(userId, { name: 'Zerodha', currency: 'INR' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(await accounts.list(userId)).toHaveLength(1);
  });

  it('records buys and sells and refuses to oversell', async () => {
    const userId = await createUser();
    const acct = await accounts.create(userId, { name: 'Zerodha', currency: 'INR' });
    const base = { accountId: acct.id, instrument: stock(INR_STOCK) };

    const bought = await txns.create(userId, {
      ...base,
      type: 'buy',
      tradeDate: '2025-01-10',
      quantity: '10',
      price: '100',
      fees: '20',
    });
    expect(bought).toMatchObject({
      type: 'buy',
      quantity: '10',
      price: '100',
      fees: '20',
      amount: '-1020',
      currency: 'INR',
    });

    await txns.create(userId, { ...base, type: 'sell', tradeDate: '2025-03-01', quantity: '4', price: '110' });
    await expect(
      txns.create(userId, { ...base, type: 'sell', tradeDate: '2025-04-01', quantity: '7', price: '110' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      txns.create(userId, { ...base, type: 'buy', tradeDate: '2999-01-01', quantity: '1', price: '1' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(await txns.list(userId, acct.id)).toHaveLength(2);
  });

  it('will not delete a buy that a later sale depends on', async () => {
    const userId = await createUser();
    const acct = await accounts.create(userId, { name: 'Groww', currency: 'INR' });
    const base = { accountId: acct.id, instrument: stock(INR_STOCK) };
    const buy = await txns.create(userId, {
      ...base,
      type: 'buy',
      tradeDate: '2025-01-10',
      quantity: '5',
      price: '100',
    });
    const sale = await txns.create(userId, {
      ...base,
      type: 'sell',
      tradeDate: '2025-02-10',
      quantity: '5',
      price: '120',
    });

    await expect(txns.remove(userId, buy.id)).rejects.toBeInstanceOf(UnprocessableEntityException);

    await txns.remove(userId, sale.id);
    await txns.remove(userId, buy.id);
    expect(await txns.list(userId, acct.id)).toEqual([]);
  });

  it('values holdings across accounts and currencies in rupees', async () => {
    const userId = await createUser();
    const zerodha = await accounts.create(userId, { name: 'Zerodha', currency: 'INR' });
    const groww = await accounts.create(userId, { name: 'Groww', currency: 'INR' });
    const vested = await accounts.create(userId, { name: 'Vested', currency: 'USD' });

    // Same stock at two brokers: 10 @ 100 and 5 @ 100, live price 120.
    await txns.create(userId, {
      accountId: zerodha.id,
      instrument: stock(INR_STOCK),
      type: 'buy',
      tradeDate: '2025-01-10',
      quantity: '10',
      price: '100',
    });
    await txns.create(userId, {
      accountId: groww.id,
      instrument: stock(INR_STOCK),
      type: 'buy',
      tradeDate: '2025-02-10',
      quantity: '5',
      price: '100',
    });
    // A US stock: 10 @ $10, live $12, USD/INR 90.
    await txns.create(userId, {
      accountId: vested.id,
      instrument: stock(USD_STOCK),
      type: 'buy',
      tradeDate: '2025-01-15',
      quantity: '10',
      price: '10',
    });
    // A fund: 40 units @ 20, live NAV 25.
    await txns.create(userId, {
      accountId: groww.id,
      instrument: { kind: 'fund', code: FUND },
      type: 'buy',
      tradeDate: '2025-03-05',
      quantity: '40',
      price: '20',
    });

    const summary = await valuation.summary(userId);
    const byKey = new Map(summary.holdings.map((h) => [h.instrumentKey, h]));

    const inr = byKey.get(INR_STOCK);
    expect(inr).toMatchObject({
      quantity: '15',
      valueInr: '1800.00',
      investedInr: '1500.00',
      unrealizedInr: '300.00',
      unrealizedPct: 20,
      sector: 'IT services',
    });
    expect(inr?.accounts).toEqual(['Groww', 'Zerodha']);

    expect(byKey.get(USD_STOCK)).toMatchObject({ valueInr: '10800.00', investedInr: '9000.00', currency: 'USD' });
    expect(byKey.get(`MF-${FUND}`)).toMatchObject({ schemeCode: FUND, valueInr: '1000.00', assetClass: 'mutual_fund' });

    expect(summary.totals).toMatchObject({ valueInr: '13600.00', investedInr: '11300.00', unrealizedInr: '2300.00' });
    expect(summary.totals.xirr).not.toBeNull();
    expect(summary.holdings[0]?.instrumentKey).toBe(USD_STOCK); // sorted by value
    expect(summary.allocation.market.map((s) => s.label)).toEqual(['US', 'India']);
    expect(summary.holdings.reduce((sum, h) => sum + h.weight, 0)).toBeCloseTo(100, 1);
  });

  it('falls back to cost when a holding cannot be priced', async () => {
    const userId = await createUser();
    const acct = await accounts.create(userId, { name: 'Zerodha', currency: 'INR' });
    await txns.create(userId, {
      accountId: acct.id,
      instrument: stock(UNPRICED),
      type: 'buy',
      tradeDate: '2025-01-10',
      quantity: '3',
      price: '100',
    });

    const [holding] = (await valuation.summary(userId)).holdings;

    expect(holding).toMatchObject({
      priced: false,
      price: null,
      valueInr: '300.00',
      unrealizedInr: '0.00',
      xirr: null,
    });
  });

  it('keeps realized gains and dividends after a position is closed', async () => {
    const userId = await createUser();
    const acct = await accounts.create(userId, { name: 'Zerodha', currency: 'INR' });
    const base = { accountId: acct.id, instrument: stock(INR_STOCK) };
    await txns.create(userId, { ...base, type: 'buy', tradeDate: '2025-01-10', quantity: '10', price: '100' });
    await txns.create(userId, { ...base, type: 'dividend', tradeDate: '2025-02-10', amount: '50' });
    await txns.create(userId, {
      ...base,
      type: 'sell',
      tradeDate: '2025-03-10',
      quantity: '10',
      price: '130',
      fees: '10',
    });

    const summary = await valuation.summary(userId);

    expect(summary.holdings).toEqual([]);
    expect(summary.totals).toMatchObject({ realizedInr: '290.00', dividendsInr: '50.00', valueInr: '0.00' });
  });

  it("never exposes or changes another user's data", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const acct = await accounts.create(alice, { name: 'Zerodha', currency: 'INR' });
    const t = await txns.create(alice, {
      accountId: acct.id,
      instrument: stock(INR_STOCK),
      type: 'buy',
      tradeDate: '2025-01-10',
      quantity: '1',
      price: '100',
    });

    expect(await accounts.list(bob)).toEqual([]);
    expect(await txns.list(bob)).toEqual([]);
    await expect(txns.remove(bob, t.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      txns.create(bob, {
        accountId: acct.id,
        instrument: stock(INR_STOCK),
        type: 'buy',
        tradeDate: '2025-01-10',
        quantity: '1',
        price: '1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(accounts.remove(bob, acct.id)).rejects.toBeInstanceOf(NotFoundException);
  });
});

import { randomUUID } from 'node:crypto';
import { Decimal } from '@folio/shared';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccountsService } from './accounts.js';
import { BrokerRequestError } from './brokers/http.js';
import { BrokersService } from './brokers/service.js';
import type { BrokerAdapter, BrokerHolding, BrokerSession } from './brokers/types.js';
import type { Database } from './database.js';
import { BadRequestError } from './errors.js';
import { InstrumentsService } from './instruments.js';
import * as schema from './schema.js';
import { marketFromRoutes } from './testing/market-from-routes.js';
import { TransactionsService } from './transactions.js';
import { ValuationService } from './valuation.js';

// Integration test: runs against a real, migrated Postgres when DATABASE_URL is set (CI provides one).
const databaseUrl = process.env.DATABASE_URL;

const run = randomUUID().slice(0, 6).toUpperCase();
const PRICED = `B${run}A`; // Folio has a live price for it
const UNPRICED = `B${run}B`; // only the broker's last price
const SECRET = 'k'.repeat(43);

/** Prices PRICED at 120 and knows nothing about UNPRICED, like a symbol Yahoo cannot find. */
async function fakeGateway(path: string): Promise<unknown> {
  const [route, qs = ''] = path.split('?');
  if (route === '/v1/fx') return { base: 'USD', quote: 'INR', rate: '90', date: '2026-11-26', source: 'test' };
  if (route === '/v1/screener') {
    const symbols = (new URLSearchParams(qs).get('symbols') ?? '').split(',').filter((s) => s === `${PRICED}.NS`);
    return {
      rows: symbols.map((symbol) => ({
        symbol,
        name: symbol,
        currency: 'INR',
        sector: 'IT services',
        price: '120',
        changePercent: 1,
        metrics: { asOf: '2026-11-26', returns: {}, upMonths: 0, months: 0 },
      })),
      unavailable: {},
    };
  }
  if (route === '/v1/funds/screener') return { rows: [], unavailable: {} };
  throw new Error(`fake gateway has no route for ${path}`);
}

const holding = (symbol: string, quantity: number, averagePrice: number, lastPrice?: number): BrokerHolding => ({
  tradingSymbol: symbol,
  exchange: 'NSE',
  isin: null,
  name: null,
  quantity: new Decimal(quantity),
  averagePrice: new Decimal(averagePrice),
  lastPrice: lastPrice === undefined ? null : new Decimal(lastPrice),
  currency: 'INR',
});

/** A broker whose holdings, session and failures each test sets directly. */
class FakeBroker implements BrokerAdapter {
  readonly id = 'dhan' as const;
  readonly login = 'redirect' as const;
  reported: BrokerHolding[] = [];
  failWith: Error | null = null;
  calls = 0;
  expiresAt = new Date(Date.now() + 3_600_000);

  async startLogin() {
    return { url: 'https://broker.example/login' };
  }
  async completeLogin(params: Record<string, string>): Promise<BrokerSession> {
    return { accessToken: `token-${params.tokenId}`, expiresAt: this.expiresAt, userName: 'Owner' };
  }
  async holdings(accessToken: string): Promise<BrokerHolding[]> {
    this.calls++;
    expect(accessToken.startsWith('token-')).toBe(true);
    if (this.failWith) throw this.failWith;
    return this.reported;
  }
}

/** A broker that renews its session with a refresh token instead of a new login. */
class RenewingBroker extends FakeBroker {
  override readonly id = 'dhan' as const;
  renewals = 0;
  override async completeLogin(params: Record<string, string>): Promise<BrokerSession> {
    return { ...(await super.completeLogin(params)), refresh: 'refresh-1' };
  }
  async refresh(refresh: string): Promise<BrokerSession> {
    this.renewals++;
    expect(refresh).toBe('refresh-1');
    return { accessToken: 'token-renewed', expiresAt: new Date(Date.now() + 3_600_000), userName: null };
  }
}

describe.skipIf(!databaseUrl)('broker sync (Postgres)', () => {
  let pool: Pool;
  let db: Database;
  let accounts: AccountsService;
  let txns: TransactionsService;
  let valuation: ValuationService;
  const userIds: string[] = [];

  async function createUser(): Promise<string> {
    const [user] = await db
      .insert(schema.users)
      .values({ email: `br-${randomUUID()}@folio.test`, displayName: 'Test' })
      .returning({ id: schema.users.id });
    if (!user) throw new Error('user insert failed');
    userIds.push(user.id);
    return user.id;
  }

  const service = (adapter: BrokerAdapter) => new BrokersService(db, { adapters: [adapter], secret: SECRET });

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl });
    db = drizzle({ client: pool, schema });
    const market = marketFromRoutes(fakeGateway);
    accounts = new AccountsService(db);
    txns = new TransactionsService(db, accounts, new InstrumentsService(db, market));
    valuation = new ValuationService(db, market);
  });

  afterAll(async () => {
    if (userIds.length) await db.delete(schema.users).where(inArray(schema.users.id, userIds));
    await db.delete(schema.instruments).where(inArray(schema.instruments.symbol, [`${PRICED}.NS`, `${UNPRICED}.NS`]));
    await pool.end();
  });

  it('connects, stores the session encrypted, and values the synced holdings live', async () => {
    const userId = await createUser();
    const broker = new FakeBroker();
    broker.reported = [holding(PRICED, 10, 100), holding(UNPRICED, 2, 50, 55)];
    const result = await service(broker).completeLogin(userId, 'dhan', { tokenId: 'abc' }, 'https://x/connect/dhan');

    expect(result.connection).toMatchObject({ accountName: 'Dhan', status: 'active', holdings: 2, error: null });
    const [stored] = await db
      .select()
      .from(schema.brokerConnections)
      .where(eq(schema.brokerConnections.userId, userId));
    expect(stored?.accessToken).toBeTruthy();
    expect(stored?.accessToken).not.toContain('token-abc');

    const [account] = await accounts.list(userId);
    expect(account).toMatchObject({ name: 'Dhan', syncedFrom: 'dhan' });

    const summary = await valuation.summary(userId);
    const priced = summary.holdings.find((h) => h.symbol === `${PRICED}.NS`);
    const fallback = summary.holdings.find((h) => h.symbol === `${UNPRICED}.NS`);
    expect(priced).toMatchObject({ quantity: '10', avgCost: '100', price: '120', valueInr: '1200.00', synced: true });
    expect(priced?.xirr).toBeNull();
    // No live price: the broker's last price from the sync, not cost.
    expect(fallback).toMatchObject({ price: '55', valueInr: '110.00', priced: true });
    expect(summary.totals.valueInr).toBe('1310.00');
    expect(summary.totals.xirr).toBeNull();
  });

  it('replaces the snapshot on each sync and reports holdings it cannot match', async () => {
    const userId = await createUser();
    const broker = new FakeBroker();
    const brokers = service(broker);
    broker.reported = [holding(PRICED, 10, 100), holding(UNPRICED, 2, 50)];
    await brokers.completeLogin(userId, 'dhan', { tokenId: 'a' }, '');

    broker.reported = [holding(PRICED, 4, 100), holding('NOT A SYMBOL', 1, 1)];
    const result = await brokers.sync(userId, 'dhan');
    expect(result.connection?.holdings).toBe(1);
    expect(result.connection?.error).toContain('NOT A SYMBOL');
    const summary = await valuation.summary(userId);
    expect(summary.holdings.map((h) => [h.symbol, h.quantity])).toEqual([[`${PRICED}.NS`, '4']]);
  });

  it('refuses trades recorded into a synced account', async () => {
    const userId = await createUser();
    const broker = new FakeBroker();
    broker.reported = [holding(PRICED, 1, 100)];
    const { connection } = await service(broker).completeLogin(userId, 'dhan', { tokenId: 'a' }, '');
    const accountId = connection?.accountId ?? '';
    await expect(
      txns.create(userId, {
        accountId,
        instrument: { kind: 'symbol', symbol: `${PRICED}.NS` },
        type: 'buy',
        tradeDate: '2026-11-02',
        quantity: '1',
        price: '100',
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('keeps the last snapshot when the session ends, without calling the broker', async () => {
    const userId = await createUser();
    const broker = new FakeBroker();
    broker.reported = [holding(PRICED, 3, 100)];
    const brokers = service(broker);
    await brokers.completeLogin(userId, 'dhan', { tokenId: 'a' }, '');

    // The broker ends the session early (a logout elsewhere): marked expired, snapshot kept.
    broker.failWith = new BrokerRequestError('Dhan: token invalid', 401, undefined, true);
    const ended = await brokers.sync(userId, 'dhan');
    expect(ended.connection).toMatchObject({ status: 'expired', holdings: 1 });
    expect(ended.connection?.error).toMatch(/log in again/i);

    // With no session left, a sync does not reach the broker at all.
    const calls = broker.calls;
    await brokers.sync(userId, 'dhan');
    expect(broker.calls).toBe(calls);
    expect((await valuation.summary(userId)).holdings).toHaveLength(1);
  });

  it('records a passing failure without ending the session', async () => {
    const userId = await createUser();
    const broker = new FakeBroker();
    const brokers = service(broker);
    await brokers.completeLogin(userId, 'dhan', { tokenId: 'a' }, '');
    broker.failWith = new BrokerRequestError('Dhan: request failed (503)', 503, undefined, false);
    const result = await brokers.sync(userId, 'dhan');
    expect(result.connection).toMatchObject({ status: 'active', error: 'Dhan: request failed (503)' });
  });

  it('renews an expired session with the refresh token instead of asking for a login', async () => {
    const userId = await createUser();
    const broker = new RenewingBroker();
    broker.expiresAt = new Date(Date.now() - 1000); // already expired when stored
    broker.reported = [holding(PRICED, 1, 100)];
    const result = await service(broker).completeLogin(userId, 'dhan', { tokenId: 'a' }, '');
    expect(broker.renewals).toBe(1);
    expect(result.connection).toMatchObject({ status: 'active', renews: true, holdings: 1 });
  });

  it('names the account "Dhan (synced)" when the owner already has a Dhan account', async () => {
    const userId = await createUser();
    await accounts.create(userId, { name: 'Dhan', currency: 'INR' });
    const result = await service(new FakeBroker()).completeLogin(userId, 'dhan', { tokenId: 'a' }, '');
    expect(result.connection?.accountName).toBe('Dhan (synced)');
  });

  it('cannot read a stored session with a different key', async () => {
    const userId = await createUser();
    const broker = new FakeBroker();
    await service(broker).completeLogin(userId, 'dhan', { tokenId: 'a' }, '');
    const other = new BrokersService(db, { adapters: [broker], secret: 'z'.repeat(43) });
    const result = await other.sync(userId, 'dhan');
    expect(result.connection?.status).toBe('expired');
  });

  it('disconnecting removes the account and its holdings, and only for its owner', async () => {
    const userId = await createUser();
    const stranger = await createUser();
    const broker = new FakeBroker();
    broker.reported = [holding(PRICED, 1, 100)];
    const brokers = service(broker);
    await brokers.completeLogin(userId, 'dhan', { tokenId: 'a' }, '');

    await expect(brokers.disconnect(stranger, 'dhan')).rejects.toThrow('not connected');
    await brokers.disconnect(userId, 'dhan');
    expect(await accounts.list(userId)).toHaveLength(0);
    expect((await valuation.summary(userId)).holdings).toHaveLength(0);
    expect((await brokers.list(userId)).brokers.find((b) => b.id === 'dhan')?.connection).toBeNull();
  });

  it('is off without a secret', async () => {
    const userId = await createUser();
    const off = new BrokersService(db, { adapters: [new FakeBroker()], secret: null });
    expect((await off.list(userId)).enabled).toBe(false);
    await expect(off.startLogin('dhan', '', 's'.repeat(16))).rejects.toThrow('not set up');
  });
});

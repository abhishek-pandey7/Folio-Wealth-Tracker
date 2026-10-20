import { randomUUID } from 'node:crypto';
import { sipDueDates } from '@folio/shared';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccountsService } from './accounts.js';
import type { Database } from './database.js';
import { ConflictError, UnprocessableError } from './errors.js';
import { GoalsService } from './goals.js';
import { InstrumentsService } from './instruments.js';
import * as schema from './schema.js';
import { SipsService } from './sips.js';
import { marketFromRoutes } from './testing/market-from-routes.js';
import { TransactionsService } from './transactions.js';
import { ValuationService } from './valuation.js';

const databaseUrl = process.env.DATABASE_URL;
const today = () => new Date().toISOString().slice(0, 10);

const FUND = String(70000000 + Math.floor(Math.random() * 999999));
const STOCK = `G${randomUUID().slice(0, 6).toUpperCase()}.NS`;
const NAV = '50';

const metrics = {
  asOf: '2026-10-19',
  returns: { '1d': 0, '1w': 0, '1m': 0, '3m': 0, '6m': 0, ytd: 0, '1y': 0, '3y': null, '5y': null },
  volatility1y: null,
  maxDrawdown1y: null,
  riskAdjusted1y: null,
  upMonths: 0,
  months: 0,
};

/** Every NAV is ₹50, published on the requested date (never in the future), so expectations are exact. */
async function fakeGateway(path: string): Promise<unknown> {
  const [route, qs = ''] = path.split('?');
  const params = new URLSearchParams(qs);
  if (route?.endsWith('/navs')) {
    return (params.get('on') ?? '')
      .split(',')
      .filter((d) => d <= today())
      .map((d) => ({ requested: d, date: d, nav: NAV }));
  }
  if (route === '/v1/funds/screener') {
    return {
      rows: (params.get('codes') ?? '').split(',').map((code) => ({ schemeCode: code, name: 'F', nav: NAV, metrics })),
      unavailable: {},
    };
  }
  if (route === '/v1/screener') {
    return {
      rows: (params.get('symbols') ?? '').split(',').map((symbol) => ({
        symbol,
        name: symbol,
        currency: 'INR',
        sector: 'IT services',
        price: '200',
        changePercent: 0,
        metrics,
      })),
      unavailable: {},
    };
  }
  if (route === '/v1/fx')
    return { base: 'USD', quote: 'INR', rate: '90', date: '2026-10-19', source: 't', stale: false };
  if (route?.startsWith('/v1/quotes/'))
    return { symbol: decodeURIComponent(route.split('/').at(-1) ?? ''), currency: 'INR', price: '200' };
  if (route?.startsWith('/v1/funds/'))
    return { schemeCode: route.split('/').at(-1), name: `Test SIP Fund ${FUND}`, nav: NAV };
  throw new Error(`fake gateway has no route for ${path}`);
}

describe.skipIf(!databaseUrl)('SIPs and goals (Postgres)', () => {
  let pool: Pool;
  let db: Database;
  let accounts: AccountsService;
  let txns: TransactionsService;
  let sips: SipsService;
  let goals: GoalsService;
  const userIds: string[] = [];

  async function setup() {
    const [user] = await db
      .insert(schema.users)
      .values({ email: `plan-${randomUUID()}@folio.test`, displayName: 'Test' })
      .returning({ id: schema.users.id });
    if (!user) throw new Error('user insert failed');
    userIds.push(user.id);
    const account = await accounts.create(user.id, { name: 'Groww', currency: 'INR' });
    return { userId: user.id, accountId: account.id };
  }

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl });
    db = drizzle({ client: pool, schema });
    const gateway = marketFromRoutes(fakeGateway);
    const instruments = new InstrumentsService(db, gateway);
    accounts = new AccountsService(db);
    txns = new TransactionsService(db, accounts, instruments);
    sips = new SipsService(db, instruments, gateway);
    goals = new GoalsService(db, new ValuationService(db, gateway));
  });

  afterAll(async () => {
    if (userIds.length) await db.delete(schema.users).where(inArray(schema.users.id, userIds));
    await db.delete(schema.instruments).where(inArray(schema.instruments.symbol, [`MF-${FUND}`, STOCK]));
    await pool.end();
  });

  it('backfills every instalment since a past start date at that date’s NAV', async () => {
    const { userId, accountId } = await setup();

    const sip = await sips.create(userId, {
      accountId,
      schemeCode: FUND,
      amount: '5000',
      dayOfMonth: 5,
      startDate: '2025-01-05',
    });

    const expected = sipDueDates('2025-01-05', 5, today()).length;
    expect(sip).toMatchObject({ instalments: expected, status: 'active', amount: '5000' });
    expect(sip.investedInr).toBe((expected * 5000).toFixed(2));

    const recorded = (await txns.list(userId)).filter((t) => t.notes === 'SIP instalment');
    expect(recorded).toHaveLength(expected);
    expect(recorded[0]).toMatchObject({ type: 'buy', quantity: '100', price: '50', amount: '-5000' });
  });

  it('is idempotent: running again records nothing new', async () => {
    const { userId, accountId } = await setup();
    await sips.create(userId, { accountId, schemeCode: FUND, amount: '1000', dayOfMonth: 10, startDate: '2025-03-01' });

    expect(await sips.catchUp(userId, true)).toBe(0);
    expect(await sips.catchUp(userId, true)).toBe(0);
  });

  it('applies a new day or amount from today on, never rewriting the past', async () => {
    const { userId, accountId } = await setup();
    const sip = await sips.create(userId, {
      accountId,
      schemeCode: FUND,
      amount: '2000',
      dayOfMonth: 5,
      startDate: '2025-01-05',
    });

    const moved = await sips.update(userId, sip.id, { dayOfMonth: 20 });
    await sips.catchUp(userId, true);

    // Under the new day, months since January would have new due dates; none may be invented.
    expect((await sips.list(userId))[0]?.instalments).toBe(moved.instalments);
  });

  it('pauses, refuses to restart a stopped SIP, and keeps history when deleted', async () => {
    const { userId, accountId } = await setup();
    const sip = await sips.create(userId, {
      accountId,
      schemeCode: FUND,
      amount: '1500',
      dayOfMonth: 1,
      startDate: '2025-06-01',
    });

    expect((await sips.update(userId, sip.id, { status: 'paused' })).nextDue).toBeNull();
    await sips.update(userId, sip.id, { status: 'stopped' });
    await expect(sips.update(userId, sip.id, { status: 'active' })).rejects.toBeInstanceOf(UnprocessableError);

    await sips.remove(userId, sip.id);
    expect(await sips.list(userId)).toEqual([]);
    expect((await txns.list(userId)).length).toBe(sip.instalments);
  });

  it('tracks a goal from linked holdings and SIPs, with a projection', async () => {
    const { userId, accountId } = await setup();
    await txns.create(userId, {
      accountId,
      instrument: { kind: 'symbol', symbol: STOCK },
      type: 'buy',
      tradeDate: '2025-01-10',
      quantity: '100',
      price: '150',
    });
    const nextYear = `${Number(today().slice(0, 4)) + 5}-01-01`;
    const goal = await goals.create(userId, {
      name: 'House',
      targetAmount: '2000000',
      targetDate: nextYear,
      assumedReturn: 0.1,
    });
    const sip = await sips.create(userId, {
      accountId,
      schemeCode: FUND,
      amount: '10000',
      dayOfMonth: 5,
      startDate: '2099-01-05',
      goalId: goal.id,
    });

    const linked = await goals.setHoldings(userId, goal.id, { holdings: [{ instrumentKey: STOCK, share: 0.5 }] });

    // Half of 100 shares at ₹200.
    expect(linked).toMatchObject({ currentInr: '10000.00', monthlySipInr: '10000.00', progressPct: 0.5 });
    expect(linked.sips.map((s) => s.id)).toEqual([sip.id]);
    expect(Number(linked.projectedInr)).toBeGreaterThan(10000);
    expect(Number(linked.requiredMonthlyInr)).toBeGreaterThan(0);
    expect(linked.onTrack).toBe(false);
  });

  it('never assigns more than 100% of a holding across goals', async () => {
    const { userId, accountId } = await setup();
    await txns.create(userId, {
      accountId,
      instrument: { kind: 'symbol', symbol: STOCK },
      type: 'buy',
      tradeDate: '2025-01-10',
      quantity: '1',
      price: '150',
    });
    const a = await goals.create(userId, { name: 'House', targetAmount: '100000', assumedReturn: 0.1 });
    const b = await goals.create(userId, { name: 'Car', targetAmount: '50000', assumedReturn: 0.1 });

    await goals.setHoldings(userId, a.id, { holdings: [{ instrumentKey: STOCK, share: 0.7 }] });

    await expect(goals.setHoldings(userId, b.id, { holdings: [{ instrumentKey: STOCK, share: 0.5 }] })).rejects.toThrow(
      /already assigned 70% to House; at most 30% is left/,
    );
    await goals.setHoldings(userId, b.id, { holdings: [{ instrumentKey: STOCK, share: 0.3 }] });
  });

  it('validates goals', async () => {
    const { userId } = await setup();
    await goals.create(userId, { name: 'Emergency fund', targetAmount: '300000', assumedReturn: 0.06 });

    await expect(
      goals.create(userId, { name: 'Emergency fund', targetAmount: '1', assumedReturn: 0.1 }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      goals.create(userId, { name: 'Past', targetAmount: '1', targetDate: '2020-01-01', assumedReturn: 0.1 }),
    ).rejects.toBeInstanceOf(UnprocessableError);
    const [goal] = await goals.list(userId);
    await expect(
      goals.setHoldings(userId, goal?.id ?? '', { holdings: [{ instrumentKey: 'NOTHELD.NS', share: 1 }] }),
    ).rejects.toThrow(/no transactions in NOTHELD.NS/);
  });

  it('deleting a goal unlinks its SIP without touching it', async () => {
    const { userId, accountId } = await setup();
    const goal = await goals.create(userId, { name: 'Trip', targetAmount: '100000', assumedReturn: 0.1 });
    const sip = await sips.create(userId, {
      accountId,
      schemeCode: FUND,
      amount: '1000',
      dayOfMonth: 5,
      startDate: '2099-01-05',
      goalId: goal.id,
    });

    await goals.remove(userId, goal.id);

    const [row] = await db.select().from(schema.sips).where(eq(schema.sips.id, sip.id));
    expect(row?.goalId).toBeNull();
    expect(row?.status).toBe('active');
  });
});

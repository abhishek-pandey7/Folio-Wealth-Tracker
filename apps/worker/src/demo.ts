// The public demo. Anyone without a session acts as this user, so a reviewer
// opening the site from a resume sees a realistic portfolio and can change it
// freely; the cron job puts it back every night. Every query in core is scoped
// by user id, so the demo can never see or touch the owner's data.

import {
  AccountsService,
  CurrentUserService,
  type Database,
  GoalsService,
  InstrumentsService,
  type Logger,
  type MarketData,
  SipsService,
  schema,
  TransactionsService,
  ValuationService,
  WatchlistService,
} from '@folio/core';
import { eq, inArray } from 'drizzle-orm';
import { isoDate } from './market/analytics.js';

/** `.invalid` is reserved (RFC 2606), so this can never be a real person's address. */
export const DEMO_EMAIL = 'demo@folio.invalid';

const DAY_MS = 86_400_000;

type Period = '6m' | '1y' | '3y';
const YEARS: Record<Period, number> = { '6m': 0.5, '1y': 1, '3y': 3 };

interface Buy {
  account: 'zerodha' | 'vested';
  symbol: string;
  quantity: string;
  /** Bought this long ago, at the price implied by the stock's return over the period. */
  ago: Period;
}

const BUYS: Buy[] = [
  { account: 'zerodha', symbol: 'HDFCBANK.NS', quantity: '40', ago: '3y' },
  { account: 'zerodha', symbol: 'RELIANCE.NS', quantity: '30', ago: '3y' },
  { account: 'zerodha', symbol: 'TCS.NS', quantity: '15', ago: '1y' },
  { account: 'zerodha', symbol: 'NIFTYBEES.NS', quantity: '300', ago: '1y' },
  { account: 'zerodha', symbol: 'ITC.NS', quantity: '200', ago: '6m' },
  { account: 'vested', symbol: 'AAPL', quantity: '10', ago: '3y' },
  { account: 'vested', symbol: 'MSFT', quantity: '6', ago: '1y' },
  { account: 'vested', symbol: 'VOO', quantity: '8', ago: '1y' },
];

/** Everything else bought here is a company share. */
const ETFS = new Set(['NIFTYBEES.NS', 'VOO']);

const SIPS = [
  { code: '122639', amount: '10000', dayOfMonth: 5, monthsAgo: 24 }, // Parag Parikh Flexi Cap, Direct Growth
  { code: '120716', amount: '5000', dayOfMonth: 15, monthsAgo: 18 }, // UTI Nifty 50 Index, Direct Growth
];

const STARS = ['INFY.NS', 'NVDA', '^NSEI'];

/** The symbols the seed prices from stored statistics; seeding waits until all of them have some. */
export const DEMO_SYMBOLS = [...new Set(BUYS.map((b) => b.symbol))];

const monthsBack = (months: number) => {
  const d = new Date();
  return isoDate(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, d.getUTCDate()));
};

/** Whether the demo user currently has a portfolio. */
export async function demoSeeded(db: Database): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.portfolios.id })
    .from(schema.portfolios)
    .innerJoin(schema.users, eq(schema.portfolios.userId, schema.users.id))
    .where(eq(schema.users.email, DEMO_EMAIL))
    .limit(1);
  return Boolean(row);
}

/** Wipes the demo user (everything cascades) and builds the sample portfolio again. */
export async function resetDemo(db: Database, market: MarketData, logger: Logger): Promise<{ trades: number }> {
  const stats = await db
    .select({ symbol: schema.symbolData.symbol, stats: schema.symbolData.stats })
    .from(schema.symbolData)
    .where(inArray(schema.symbolData.symbol, DEMO_SYMBOLS));
  const bySymbol = new Map(stats.flatMap((r) => (r.stats ? [[r.symbol, r.stats] as const] : [])));
  if (bySymbol.size < DEMO_SYMBOLS.length) throw new Error('Demo symbols are still loading');

  await db.delete(schema.users).where(eq(schema.users.email, DEMO_EMAIL));
  const userId = await new CurrentUserService(db, DEMO_EMAIL).id();

  const instruments = new InstrumentsService(db, market);
  const accounts = new AccountsService(db);
  const transactions = new TransactionsService(db, accounts, instruments);
  const goals = new GoalsService(db, new ValuationService(db, market, logger));
  const sips = new SipsService(db, instruments, market, logger);
  const watchlist = new WatchlistService(db, instruments);

  const zerodha = await accounts.create(userId, { name: 'Zerodha', broker: 'Zerodha', currency: 'INR' });
  const groww = await accounts.create(userId, { name: 'Groww', broker: 'Groww', currency: 'INR' });
  const vested = await accounts.create(userId, { name: 'Vested', broker: 'Vested', currency: 'USD' });
  const accountId = { zerodha: zerodha.id, vested: vested.id };

  let trades = 0;
  const today = Date.now();
  for (const b of BUYS) {
    const s = bySymbol.get(b.symbol);
    const r = s?.metrics.returns[b.ago];
    if (!s || r === null || r === undefined) continue; // too little history for that period
    // 3y returns are annualized, so compound them back; shorter periods are totals.
    const growth = b.ago === '3y' ? (1 + r / 100) ** 3 : 1 + r / 100;
    await transactions.create(userId, {
      accountId: accountId[b.account],
      instrument: { kind: 'symbol', symbol: b.symbol, name: s.name, type: ETFS.has(b.symbol) ? 'etf' : 'equity' },
      type: 'buy',
      tradeDate: isoDate(today - YEARS[b.ago] * 365 * DAY_MS),
      quantity: b.quantity,
      price: (Number(s.price) / growth).toFixed(2),
      fees: '20',
    });
    trades++;
  }

  // A partial sale and a dividend, so realized gains and income have something to show.
  const reliance = bySymbol.get('RELIANCE.NS');
  const r6m = reliance?.metrics.returns['6m'];
  if (reliance && r6m !== null && r6m !== undefined) {
    await transactions.create(userId, {
      accountId: zerodha.id,
      instrument: { kind: 'symbol', symbol: 'RELIANCE.NS' },
      type: 'sell',
      tradeDate: monthsBack(6),
      quantity: '10',
      price: (Number(reliance.price) / (1 + r6m / 100)).toFixed(2),
      fees: '20',
    });
    trades++;
  }
  await transactions.create(userId, {
    accountId: zerodha.id,
    instrument: { kind: 'symbol', symbol: 'ITC.NS' },
    type: 'dividend',
    tradeDate: monthsBack(2),
    amount: '1300',
  });
  trades++;

  const house = await goals.create(userId, {
    name: 'House down payment',
    targetAmount: '2500000',
    targetDate: `${new Date().getUTCFullYear() + 5}-03-31`,
    assumedReturn: 0.11,
  });
  const emergency = await goals.create(userId, {
    name: 'Emergency fund',
    targetAmount: '300000',
    targetDate: monthsBack(-12),
    assumedReturn: 0.07,
  });

  // Backfilled at each instalment date's real NAV.
  for (const [i, sip] of SIPS.entries()) {
    await sips.create(userId, {
      accountId: groww.id,
      schemeCode: sip.code,
      amount: sip.amount,
      dayOfMonth: sip.dayOfMonth,
      startDate: monthsBack(sip.monthsAgo),
      goalId: i === 0 ? house.id : undefined,
    });
  }

  // After the SIPs, so the fund they bought exists as a holding to count toward the goal.
  await goals.setHoldings(userId, house.id, {
    holdings: [
      { instrumentKey: 'MF-122639', share: 1 },
      { instrumentKey: 'RELIANCE.NS', share: 1 },
    ],
  });
  await goals.setHoldings(userId, emergency.id, { holdings: [{ instrumentKey: 'NIFTYBEES.NS', share: 0.5 }] });

  for (const symbol of STARS) await watchlist.star(userId, symbol, {});
  return { trades };
}

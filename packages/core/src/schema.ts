import {
  type AnyPgColumn,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** Money and quantities are NUMERIC and come back from pg as strings, never floats. */
const money = (name: string) => numeric(name, { precision: 20, scale: 4 });
const quantity = (name: string) => numeric(name, { precision: 20, scale: 6 });

export const currency = pgEnum('currency', ['INR', 'USD']);

export const assetClass = pgEnum('asset_class', [
  'equity',
  'etf',
  'mutual_fund',
  'bond',
  'gold',
  'crypto',
  'cash',
  'index',
]);

export const transactionType = pgEnum('transaction_type', [
  'buy',
  'sell',
  'dividend',
  'split',
  'deposit',
  'withdrawal',
  'fee',
]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  baseCurrency: currency('base_currency').notNull().default('INR'),
  createdAt: createdAt(),
});

/** One per brokerage account, e.g. "Zerodha", "Groww", "Vested (US)". */
export const portfolios = pgTable(
  'portfolios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    broker: text('broker'),
    currency: currency('currency').notNull(),
    /** Rebalance alert fires when any position drifts further than this from target. */
    driftThreshold: numeric('drift_threshold', { precision: 5, scale: 4 }).notNull().default('0.05'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('portfolios_user_name_idx').on(t.userId, t.name)],
);

export const instruments = pgTable('instruments', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Yahoo-style: RELIANCE.NS, 500325.BO, AAPL. */
  symbol: text('symbol').notNull().unique(),
  name: text('name').notNull(),
  assetClass: assetClass('asset_class').notNull(),
  currency: currency('currency').notNull(),
  createdAt: createdAt(),
});

/**
 * The ledger is the source of truth. Holdings, cost basis, tax lots and
 * returns are all derived by replaying it, so a correction is just a new or
 * edited transaction and every number recomputes consistently.
 */
export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    portfolioId: uuid('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    instrumentId: uuid('instrument_id').references(() => instruments.id),
    type: transactionType('type').notNull(),
    tradeDate: date('trade_date').notNull(),
    quantity: quantity('quantity'),
    price: money('price'),
    /** Cash effect on the portfolio, signed: buys and fees negative, sells and dividends positive. */
    amount: money('amount').notNull(),
    fees: money('fees').notNull().default('0'),
    currency: currency('currency').notNull(),
    notes: text('notes'),
    /** Set when the entry is a SIP instalment; one instalment per SIP per date. */
    sipId: uuid('sip_id').references((): AnyPgColumn => sips.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('transactions_portfolio_date_idx').on(t.portfolioId, t.tradeDate),
    index('transactions_instrument_idx').on(t.instrumentId),
    uniqueIndex('transactions_sip_date_idx').on(t.sipId, t.tradeDate),
  ],
);

export const targetAllocations = pgTable(
  'target_allocations',
  {
    portfolioId: uuid('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id),
    /** Fraction 0..1; a portfolio's weights must sum to 1. */
    weight: numeric('weight', { precision: 7, scale: 6 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.portfolioId, t.instrumentId] })],
);

export const watchlistItems = pgTable(
  'watchlist_items',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.instrumentId] })],
);

export const sipStatus = pgEnum('sip_status', ['active', 'paused', 'stopped']);

/** A savings goal; projections assume the stated annual return. */
export const goals = pgTable(
  'goals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    targetAmount: numeric('target_amount', { precision: 20, scale: 2 }).notNull(),
    targetDate: date('target_date'),
    assumedReturn: numeric('assumed_return', { precision: 5, scale: 4 }).notNull().default('0.1000'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('goals_user_name_idx').on(t.userId, t.name)],
);

/** A monthly mutual fund SIP. Instalments are recorded as ordinary buy transactions. */
export const sips = pgTable('sips', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  portfolioId: uuid('portfolio_id')
    .notNull()
    .references(() => portfolios.id, { onDelete: 'cascade' }),
  instrumentId: uuid('instrument_id')
    .notNull()
    .references(() => instruments.id),
  goalId: uuid('goal_id').references(() => goals.id, { onDelete: 'set null' }),
  amount: numeric('amount', { precision: 20, scale: 2 }).notNull(),
  dayOfMonth: integer('day_of_month').notNull(),
  startDate: date('start_date').notNull(),
  /** Instalments are recorded from here: the start date, or the day a paused SIP resumed. */
  activeFrom: date('active_from').notNull(),
  status: sipStatus('status').notNull().default('active'),
  createdAt: createdAt(),
});

/** How much of a holding counts toward a goal; one holding can be split across goals. */
export const goalHoldings = pgTable(
  'goal_holdings',
  {
    goalId: uuid('goal_id')
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id),
    share: numeric('share', { precision: 5, scale: 4 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.goalId, t.instrumentId] })],
);

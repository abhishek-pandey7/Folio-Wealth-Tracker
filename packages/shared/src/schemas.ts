import { z } from 'zod';
import { CURRENCIES, DECIMAL_STRING } from './money.js';

export const DecimalStringSchema = z.string().regex(DECIMAL_STRING, 'Expected a decimal string');

export const CurrencySchema = z.enum(CURRENCIES);

/**
 * Ticker symbols in Yahoo-style notation so one format covers every market:
 * AAPL, VTI, RELIANCE.NS (NSE), 500325.BO (BSE), M&M.NS, ^NSEI (index).
 */
export const SymbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\^?[A-Z0-9][A-Z0-9.&-]{0,19}$/, 'Invalid ticker symbol');

// Market data contracts. These mirror the Go gateway's JSON exactly; the API
// validates every gateway response against them, so drift fails loudly.

export const QuoteSchema = z.object({
  symbol: z.string(),
  currency: CurrencySchema,
  price: DecimalStringSchema,
  change: DecimalStringSchema,
  changePercent: DecimalStringSchema,
  previousClose: DecimalStringSchema,
  asOf: z.iso.datetime(),
  source: z.string(),
  /** True when the upstream failed and the last good quote was served. */
  stale: z.boolean(),
});
export type Quote = z.infer<typeof QuoteSchema>;

export const BatchQuotesSchema = z.object({
  quotes: z.array(QuoteSchema),
  /** Symbol → reason, for symbols that could not be priced. */
  errors: z.record(z.string(), z.string()),
});
export type BatchQuotes = z.infer<typeof BatchQuotesSchema>;

export const HISTORY_RANGES = ['1mo', '3mo', '6mo', '1y', '5y'] as const;
export const HistoryRangeSchema = z.enum(HISTORY_RANGES);
export type HistoryRange = z.infer<typeof HistoryRangeSchema>;

export const PriceHistorySchema = z.object({
  symbol: z.string(),
  currency: CurrencySchema,
  range: HistoryRangeSchema,
  interval: z.string(),
  points: z.array(z.object({ date: z.iso.date(), close: DecimalStringSchema })),
  source: z.string(),
});
export type PriceHistory = z.infer<typeof PriceHistorySchema>;

export const SymbolMatchSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  exchange: z.string(),
  type: z.enum(['equity', 'etf', 'mutual_fund', 'index']),
});
export type SymbolMatch = z.infer<typeof SymbolMatchSchema>;

export const FxRateSchema = z.object({
  base: z.string().length(3),
  quote: z.string().length(3),
  rate: DecimalStringSchema,
  date: z.iso.date(),
  source: z.string(),
  stale: z.boolean(),
});
export type FxRate = z.infer<typeof FxRateSchema>;

export const FundSchema = z.object({
  schemeCode: z.string(),
  name: z.string(),
  fundHouse: z.string(),
  category: z.string(),
  nav: DecimalStringSchema,
  navDate: z.iso.date(),
  source: z.string(),
  stale: z.boolean(),
});
export type Fund = z.infer<typeof FundSchema>;

export const FundMatchSchema = z.object({ schemeCode: z.string(), name: z.string() });
export type FundMatch = z.infer<typeof FundMatchSchema>;

export const HealthStatusSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  database: z.enum(['up', 'down']),
  marketGateway: z.enum(['up', 'down']),
  timestamp: z.iso.datetime(),
});
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

// Watchlist (starred symbols).

export const AssetClassSchema = z.enum(['equity', 'etf', 'mutual_fund', 'index', 'bond', 'gold', 'crypto', 'cash']);
export type AssetClass = z.infer<typeof AssetClassSchema>;

export const WatchlistItemSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  assetClass: AssetClassSchema,
  currency: CurrencySchema,
  starredAt: z.iso.datetime(),
  /** Set for starred mutual funds, which are identified by AMFI scheme code rather than a ticker. */
  schemeCode: z.string().nullable(),
});
export type WatchlistItem = z.infer<typeof WatchlistItemSchema>;

/** Optional display metadata from a search result. Currency is never taken from the client. */
export const StarRequestSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  type: SymbolMatchSchema.shape.type.optional(),
});
export type StarRequest = z.infer<typeof StarRequestSchema>;

// Analytics and screening. Statistics are plain numbers (percentages and
// ratios, not money); null means the history is too short to measure it.

const Stat = z.number().nullable();

export const PERIODS = ['1d', '1w', '1m', '3m', '6m', 'ytd', '1y', '3y', '5y'] as const;
export const PeriodSchema = z.enum(PERIODS);
export type Period = z.infer<typeof PeriodSchema>;

/** Periods whose returns are annualized (CAGR) rather than totals. */
export const ANNUALIZED_PERIODS: readonly Period[] = ['3y', '5y'];

export const SORT_KEYS = ['return', 'risk_adjusted', 'volatility', 'drawdown', 'consistency'] as const;
export const SortKeySchema = z.enum(SORT_KEYS);
export type SortKey = z.infer<typeof SortKeySchema>;

export const MetricsSchema = z.object({
  asOf: z.string(),
  returns: z.record(PeriodSchema, Stat),
  volatility1y: Stat,
  maxDrawdown1y: Stat,
  /** 1-year return divided by 1-year volatility: return per unit of risk. */
  riskAdjusted1y: Stat,
  upMonths: z.number().int(),
  months: z.number().int(),
});
export type Metrics = z.infer<typeof MetricsSchema>;

export const UniverseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  group: z.string(),
  region: z.enum(['IN', 'US']),
  count: z.number().int(),
});
export type Universe = z.infer<typeof UniverseSchema>;

export const SymbolStatsSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  exchange: z.string(),
  currency: CurrencySchema,
  sector: z.string(),
  price: DecimalStringSchema,
  high52w: Stat,
  low52w: Stat,
  fromHigh52w: Stat,
  metrics: MetricsSchema,
});
export type SymbolStats = z.infer<typeof SymbolStatsSchema>;

export const ScreenRowSchema = SymbolStatsSchema.extend({ changePercent: Stat });
export type ScreenRow = z.infer<typeof ScreenRowSchema>;

const screenShape = {
  period: PeriodSchema,
  sort: SortKeySchema,
  order: z.enum(['best', 'worst']),
  total: z.number().int(),
  unavailable: z.record(z.string(), z.string()),
};

export const ScreenResultSchema = z.object({
  ...screenShape,
  universe: UniverseSchema.nullable(),
  rows: z.array(ScreenRowSchema),
});
export type ScreenResult = z.infer<typeof ScreenResultSchema>;

export const FundCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  count: z.number().int(),
});
export type FundCategory = z.infer<typeof FundCategorySchema>;

export const FundStatsSchema = z.object({
  schemeCode: z.string(),
  name: z.string(),
  fundHouse: z.string(),
  category: z.string(),
  nav: DecimalStringSchema,
  navDate: z.iso.date(),
  metrics: MetricsSchema,
});
export type FundStats = z.infer<typeof FundStatsSchema>;

export const FundScreenResultSchema = z.object({
  ...screenShape,
  category: FundCategorySchema.nullable(),
  rows: z.array(FundStatsSchema),
});
export type FundScreenResult = z.infer<typeof FundScreenResultSchema>;

/** The NAV that applied to a purchase on a requested date (the next business day's, for holidays). */
export const NavOnSchema = z.object({
  requested: z.iso.date(),
  date: z.iso.date(),
  nav: DecimalStringSchema,
});
export type NavOn = z.infer<typeof NavOnSchema>;

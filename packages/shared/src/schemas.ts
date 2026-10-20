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

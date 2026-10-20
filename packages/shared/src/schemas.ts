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

export const QuoteSchema = z.object({
  symbol: z.string(),
  currency: CurrencySchema,
  price: DecimalStringSchema,
  change: DecimalStringSchema,
  changePercent: DecimalStringSchema,
  previousClose: DecimalStringSchema,
  asOf: z.iso.datetime(),
  source: z.string(),
});
export type Quote = z.infer<typeof QuoteSchema>;

export const HealthStatusSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  database: z.enum(['up', 'down']),
  timestamp: z.iso.datetime(),
});
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

import type { Fund, FundStats, NavOn, Quote, ScreenRow } from '@folio/shared';

/**
 * What the business logic needs from market data. Two implementations:
 * the Go gateway over HTTP (self-hosted stack) and direct fetches with
 * precomputed statistics (Cloudflare Workers).
 */
export interface MarketData {
  /** Canonical symbol and currency; throws NotFoundError for unknown symbols. */
  quote(symbol: string): Promise<Quote>;
  /** Throws NotFoundError for unknown scheme codes. */
  fund(code: string): Promise<Fund>;
  /** Live price, today's move and sector for each symbol it can price. */
  priceSymbols(symbols: string[]): Promise<ScreenRow[]>;
  /** Latest NAV and today's move for each fund it can price. */
  priceFunds(codes: string[]): Promise<FundStats[]>;
  usdInr(): Promise<string>;
  /** For each date, the first NAV published on or after it; unpublished dates are omitted. */
  navsOn(code: string, dates: string[]): Promise<NavOn[]>;
}

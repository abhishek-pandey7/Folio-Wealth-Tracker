import type { Fund, FundStats, NavOn, Quote, ScreenRow } from '@folio/shared';
import type { MarketData } from '../market.js';

/**
 * Builds a MarketData from a fake that answers gateway-style paths, so
 * integration tests can describe upstream data as plain routes.
 */
export function marketFromRoutes(get: (path: string) => Promise<unknown>): MarketData {
  const list = (values: string[]) => encodeURIComponent(values.join(','));
  return {
    quote: (symbol) => get(`/v1/quotes/${encodeURIComponent(symbol)}`) as Promise<Quote>,
    fund: (code) => get(`/v1/funds/${code}`) as Promise<Fund>,
    priceSymbols: async (symbols) =>
      ((await get(`/v1/screener?symbols=${list(symbols)}&period=1d&limit=100`)) as { rows: ScreenRow[] }).rows,
    priceFunds: async (codes) =>
      ((await get(`/v1/funds/screener?codes=${list(codes)}&period=1y&limit=100`)) as { rows: FundStats[] }).rows,
    usdInr: async () => ((await get('/v1/fx?base=USD&quote=INR')) as { rate: string }).rate,
    navsOn: (code, dates) => get(`/v1/funds/${code}/navs?on=${dates.join(',')}`) as Promise<NavOn[]>,
  };
}

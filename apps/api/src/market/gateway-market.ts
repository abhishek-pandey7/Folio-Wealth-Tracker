import type { MarketData } from '@folio/core';
import {
  FundSchema,
  FundScreenResultSchema,
  type FundStats,
  FxRateSchema,
  NavOnSchema,
  QuoteSchema,
  ScreenResultSchema,
  type ScreenRow,
} from '@folio/shared';
import { z } from 'zod';
import type { MarketGatewayClient } from './market-gateway.client.js';

const BATCH = 50; // the gateway's per-screen limit
// A screen whose cache is cold waits on dozens of rate-limited upstream calls.
const SCREEN_TIMEOUT_MS = 45_000;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The core's MarketData port, served by the Go market gateway. */
export class GatewayMarketData implements MarketData {
  constructor(private readonly gateway: MarketGatewayClient) {}

  quote(symbol: string) {
    return this.gateway.get(`/v1/quotes/${encodeURIComponent(symbol)}`, QuoteSchema);
  }

  fund(code: string) {
    return this.gateway.get(`/v1/funds/${encodeURIComponent(code)}`, FundSchema);
  }

  async priceSymbols(symbols: string[]): Promise<ScreenRow[]> {
    const batches = await Promise.all(
      chunk(symbols, BATCH).map((batch) =>
        this.gateway.get(
          `/v1/screener?symbols=${encodeURIComponent(batch.join(','))}&period=1d&limit=100`,
          ScreenResultSchema,
          { timeoutMs: SCREEN_TIMEOUT_MS },
        ),
      ),
    );
    return batches.flatMap((b) => b.rows);
  }

  async priceFunds(codes: string[]): Promise<FundStats[]> {
    const batches = await Promise.all(
      chunk(codes, BATCH).map((batch) =>
        this.gateway.get(
          `/v1/funds/screener?codes=${encodeURIComponent(batch.join(','))}&period=1y&limit=100`,
          FundScreenResultSchema,
          { timeoutMs: SCREEN_TIMEOUT_MS },
        ),
      ),
    );
    return batches.flatMap((b) => b.rows);
  }

  async usdInr(): Promise<string> {
    return (await this.gateway.get('/v1/fx?base=USD&quote=INR', FxRateSchema)).rate;
  }

  navsOn(code: string, dates: string[]) {
    return this.gateway.get(`/v1/funds/${encodeURIComponent(code)}/navs?on=${dates.join(',')}`, z.array(NavOnSchema));
  }
}

import {
  BatchQuotesSchema,
  FundCategorySchema,
  FundMatchSchema,
  FundSchema,
  FundScreenResultSchema,
  FundStatsSchema,
  FxRateSchema,
  PriceHistorySchema,
  QuoteSchema,
  ScreenResultSchema,
  SymbolMatchSchema,
  SymbolStatsSchema,
  UniverseSchema,
} from '@folio/shared';
import { Controller, Get, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { MarketGatewayClient } from './market-gateway.client.js';

const enc = encodeURIComponent;

// A screen whose cache is cold waits on dozens of rate-limited upstream calls.
const SCREEN_TIMEOUT_MS = 45_000;

/** Builds a query string from the allowed parameters only, dropping empty ones. */
function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      search.set(key, value);
    }
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

interface ScreenParams {
  period?: string;
  sort?: string;
  order?: string;
  limit?: string;
}

/**
 * Public market data API. A thin backend-for-frontend over the Go gateway: the
 * browser never talks to the gateway, so auth, rate limits and response shapes
 * are enforced in one place. Input validation lives in the gateway.
 */
@Controller('market')
export class MarketController {
  constructor(private readonly gateway: MarketGatewayClient) {}

  @Get('quotes')
  quotes(@Query('symbols') symbols = '') {
    return this.gateway.get(`/v1/quotes?symbols=${enc(symbols)}`, BatchQuotesSchema);
  }

  @Get('quotes/:symbol')
  quote(@Param('symbol') symbol: string) {
    return this.gateway.get(`/v1/quotes/${enc(symbol)}`, QuoteSchema);
  }

  @Get('history/:symbol')
  history(@Param('symbol') symbol: string, @Query('range') range = '1y') {
    return this.gateway.get(`/v1/history/${enc(symbol)}?range=${enc(range)}`, PriceHistorySchema);
  }

  @Get('search')
  search(@Query('q') q = '') {
    return this.gateway.get(`/v1/search?q=${enc(q)}`, z.array(SymbolMatchSchema));
  }

  @Get('fx')
  fx(@Query('base') base = 'USD', @Query('quote') quote = 'INR') {
    return this.gateway.get(`/v1/fx?base=${enc(base)}&quote=${enc(quote)}`, FxRateSchema);
  }

  @Get('universes')
  universes() {
    return this.gateway.get('/v1/universes', z.array(UniverseSchema));
  }

  @Get('screener')
  screener(@Query() params: ScreenParams & { universe?: string; symbols?: string }) {
    const { universe, symbols, period, sort, order, limit } = params;
    return this.gateway.get(
      `/v1/screener${query({ universe, symbols, period, sort, order, limit })}`,
      ScreenResultSchema,
      { timeoutMs: SCREEN_TIMEOUT_MS },
    );
  }

  @Get('stats/:symbol')
  stats(@Param('symbol') symbol: string) {
    return this.gateway.get(`/v1/stats/${enc(symbol)}`, SymbolStatsSchema);
  }

  // Literal fund routes are declared before funds/:schemeCode so they are not captured as scheme codes.
  @Get('funds/search')
  searchFunds(@Query('q') q = '') {
    return this.gateway.get(`/v1/funds/search?q=${enc(q)}`, z.array(FundMatchSchema));
  }

  @Get('funds/categories')
  fundCategories() {
    return this.gateway.get('/v1/funds/categories', z.array(FundCategorySchema), { timeoutMs: SCREEN_TIMEOUT_MS });
  }

  @Get('funds/screener')
  fundScreener(@Query() params: ScreenParams & { category?: string; codes?: string }) {
    const { category, codes, period, sort, order, limit } = params;
    return this.gateway.get(
      `/v1/funds/screener${query({ category, codes, period, sort, order, limit })}`,
      FundScreenResultSchema,
      { timeoutMs: SCREEN_TIMEOUT_MS },
    );
  }

  @Get('funds/:schemeCode')
  fund(@Param('schemeCode') schemeCode: string) {
    return this.gateway.get(`/v1/funds/${enc(schemeCode)}`, FundSchema);
  }

  @Get('funds/:schemeCode/stats')
  fundStats(@Param('schemeCode') schemeCode: string) {
    return this.gateway.get(`/v1/funds/${enc(schemeCode)}/stats`, FundStatsSchema);
  }

  @Get('funds/:schemeCode/history')
  fundHistory(@Param('schemeCode') schemeCode: string, @Query('range') range = '1y') {
    return this.gateway.get(`/v1/funds/${enc(schemeCode)}/history?range=${enc(range)}`, PriceHistorySchema);
  }
}

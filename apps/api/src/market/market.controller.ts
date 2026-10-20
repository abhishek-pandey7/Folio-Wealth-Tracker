import {
  BatchQuotesSchema,
  FundMatchSchema,
  FundSchema,
  FxRateSchema,
  PriceHistorySchema,
  QuoteSchema,
  SymbolMatchSchema,
} from '@folio/shared';
import { Controller, Get, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { MarketGatewayClient } from './market-gateway.client.js';

const enc = encodeURIComponent;

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

  // Declared before funds/:schemeCode so "search" is not captured as a scheme code.
  @Get('funds/search')
  searchFunds(@Query('q') q = '') {
    return this.gateway.get(`/v1/funds/search?q=${enc(q)}`, z.array(FundMatchSchema));
  }

  @Get('funds/:schemeCode')
  fund(@Param('schemeCode') schemeCode: string) {
    return this.gateway.get(`/v1/funds/${enc(schemeCode)}`, FundSchema);
  }
}

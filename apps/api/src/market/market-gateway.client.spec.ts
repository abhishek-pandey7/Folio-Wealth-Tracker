import { QuoteSchema } from '@folio/shared';
import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import { MarketGatewayClient } from './market-gateway.client.js';

const quote = {
  symbol: 'RELIANCE.NS',
  currency: 'INR',
  price: '1202',
  change: '-9.2',
  changePercent: '-0.76',
  previousClose: '1211.2',
  asOf: '2026-10-19T09:59:38Z',
  source: 'yahoo',
  stale: false,
};

const config = {
  get: (key: keyof Env) =>
    ({ MARKET_GATEWAY_URL: 'http://gateway.test/', MARKET_GATEWAY_TIMEOUT_MS: 1000 })[key as string],
} as unknown as ConfigService<Env, true>;

function respondWith(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe('MarketGatewayClient', () => {
  let client: MarketGatewayClient;

  beforeEach(() => {
    client = new MarketGatewayClient(config);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('returns responses that match the contract', async () => {
    const fetchMock = respondWith(200, quote);
    vi.stubGlobal('fetch', fetchMock);

    await expect(client.get('/v1/quotes/RELIANCE.NS', QuoteSchema)).resolves.toEqual(quote);
    expect(fetchMock).toHaveBeenCalledWith('http://gateway.test/v1/quotes/RELIANCE.NS', expect.anything());
  });

  it('treats a response that breaks the contract as a bad gateway', async () => {
    vi.stubGlobal('fetch', respondWith(200, { ...quote, price: 1202 }));

    await expect(client.get('/v1/quotes/RELIANCE.NS', QuoteSchema)).rejects.toBeInstanceOf(BadGatewayException);
  });

  it.each([
    [400, BadRequestException],
    [404, NotFoundException],
    [422, UnprocessableEntityException],
    [502, BadGatewayException],
    [504, BadGatewayException],
  ])('maps gateway %i to %o', async (status, exception) => {
    vi.stubGlobal('fetch', respondWith(status, { error: { code: 'x', message: 'detail' } }));

    await expect(client.get('/v1/quotes/X', QuoteSchema)).rejects.toBeInstanceOf(exception);
  });

  it('passes client-error messages through but hides upstream details', async () => {
    vi.stubGlobal('fetch', respondWith(404, { error: { message: 'not found: no mutual fund with scheme code 1' } }));
    await expect(client.get('/v1/funds/1', QuoteSchema)).rejects.toThrow('no mutual fund with scheme code 1');

    vi.stubGlobal('fetch', respondWith(502, { error: { message: 'upstream failure: yahoo returned HTTP 429' } }));
    await expect(client.get('/v1/quotes/X', QuoteSchema)).rejects.toThrow('Market data is temporarily unavailable');
  });

  it('reports an unreachable gateway as service unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );

    await expect(client.get('/v1/quotes/X', QuoteSchema)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(client.isUp()).resolves.toBe(false);
  });
});

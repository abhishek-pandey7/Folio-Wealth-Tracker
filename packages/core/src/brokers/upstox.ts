import { BadRequestError, UpstreamError } from '../errors.js';
import { call, decimal, type Fetch, field, nextIstTime, text } from './http.js';
import type { BrokerAdapter, BrokerHolding, BrokerSession, LoginStart } from './types.js';

const API = 'https://api.upstox.com/v2';

export interface UpstoxConfig {
  apiKey: string;
  apiSecret: string;
}

/**
 * Upstox API v2 (upstox.com/developer/api-documentation): a standard OAuth
 * authorization code login. The access token lasts until 3:30 AM the next
 * day. Holdings: GET /portfolio/long-term-holdings.
 */
export class UpstoxAdapter implements BrokerAdapter {
  readonly id = 'upstox' as const;
  readonly login = 'redirect' as const;

  constructor(
    private readonly config: UpstoxConfig,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  async startLogin(redirectUri: string, state: string): Promise<LoginStart> {
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.apiKey,
      redirect_uri: redirectUri,
      state,
    });
    return { url: `${API}/login/authorization/dialog?${query}` };
  }

  async completeLogin(params: Record<string, string>, redirectUri: string): Promise<BrokerSession> {
    const code = params.code;
    if (!code) throw new BadRequestError('Upstox did not send a login code back');
    const body = await call(this.fetchFn, {
      broker: 'Upstox',
      url: `${API}/login/authorization/token`,
      init: {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: this.config.apiKey,
          client_secret: this.config.apiSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      },
    });
    const accessToken = text(body, 'access_token');
    if (!accessToken) throw new UpstreamError('Upstox did not return an access token');
    return {
      accessToken,
      expiresAt: nextIstTime(3, 30),
      userName: text(body, 'user_name') ?? text(body, 'user_id'),
    };
  }

  async holdings(accessToken: string): Promise<BrokerHolding[]> {
    const body = await call(this.fetchFn, {
      broker: 'Upstox',
      url: `${API}/portfolio/long-term-holdings`,
      init: { headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` } },
    });
    const rows = field(body, 'data');
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((row): BrokerHolding[] => {
      const symbol = text(row, 'trading_symbol') ?? text(row, 'tradingsymbol');
      const quantity = decimal(field(row, 'quantity'));
      const averagePrice = decimal(field(row, 'average_price'));
      if (!symbol || !quantity?.greaterThan(0) || !averagePrice) return [];
      return [
        {
          tradingSymbol: symbol,
          exchange: text(row, 'exchange') ?? 'NSE',
          isin: text(row, 'isin'),
          name: text(row, 'company_name'),
          quantity,
          averagePrice,
          lastPrice: decimal(field(row, 'last_price')),
          currency: 'INR',
        },
      ];
    });
  }
}

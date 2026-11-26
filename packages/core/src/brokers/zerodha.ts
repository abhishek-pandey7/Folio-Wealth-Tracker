import { BadRequestError, UpstreamError } from '../errors.js';
import { call, decimal, type Fetch, field, nextIstTime, sha256Hex, text } from './http.js';
import type { BrokerAdapter, BrokerHolding, BrokerSession, LoginStart } from './types.js';

const LOGIN = 'https://kite.zerodha.com/connect/login';
const API = 'https://api.kite.trade';

export interface ZerodhaConfig {
  apiKey: string;
  apiSecret: string;
}

/**
 * Kite Connect v3 (kite.trade/docs/connect/v3), on the free Personal plan:
 * the owner logs in on Kite, which redirects back with a request_token that
 * Folio exchanges (with a SHA-256 checksum of key, token and secret) for an
 * access token valid until 6 AM the next day. Holdings: GET /portfolio/holdings.
 */
export class ZerodhaAdapter implements BrokerAdapter {
  readonly id = 'zerodha' as const;
  readonly login = 'redirect' as const;

  constructor(
    private readonly config: ZerodhaConfig,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  async startLogin(_redirectUri: string, state: string): Promise<LoginStart> {
    // The redirect URL itself is registered in Kite's developer console; redirect_params comes back on it.
    const back = encodeURIComponent(`state=${state}`);
    return { url: `${LOGIN}?v=3&api_key=${encodeURIComponent(this.config.apiKey)}&redirect_params=${back}` };
  }

  async completeLogin(params: Record<string, string>): Promise<BrokerSession> {
    if (params.status && params.status !== 'success') throw new BadRequestError('The Zerodha login was not completed');
    const requestToken = params.request_token;
    if (!requestToken) throw new BadRequestError('Zerodha did not send a login token back');
    const checksum = await sha256Hex(this.config.apiKey + requestToken + this.config.apiSecret);
    const body = await call(this.fetchFn, {
      broker: 'Zerodha',
      url: `${API}/session/token`,
      init: {
        method: 'POST',
        headers: { 'X-Kite-Version': '3', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ api_key: this.config.apiKey, request_token: requestToken, checksum }),
      },
    });
    const data = field(body, 'data');
    const accessToken = text(data, 'access_token');
    if (!accessToken) throw new UpstreamError('Zerodha did not return an access token');
    return {
      accessToken,
      expiresAt: nextIstTime(6, 0),
      userName: text(data, 'user_name') ?? text(data, 'user_id'),
    };
  }

  async holdings(accessToken: string): Promise<BrokerHolding[]> {
    const body = await call(this.fetchFn, {
      broker: 'Zerodha',
      url: `${API}/portfolio/holdings`,
      init: { headers: { 'X-Kite-Version': '3', authorization: `token ${this.config.apiKey}:${accessToken}` } },
    });
    const rows = field(body, 'data');
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((row): BrokerHolding[] => {
      const symbol = text(row, 'tradingsymbol');
      // Kite's quantity is what has reached the demat account; T1 units are listed separately.
      const delivered = decimal(field(row, 'quantity'));
      const t1 = decimal(field(row, 't1_quantity'));
      const quantity = delivered && t1 ? delivered.plus(t1) : delivered;
      const averagePrice = decimal(field(row, 'average_price'));
      if (!symbol || !quantity?.greaterThan(0) || !averagePrice) return [];
      return [
        {
          tradingSymbol: symbol,
          exchange: text(row, 'exchange') ?? 'NSE',
          isin: text(row, 'isin'),
          name: null,
          quantity,
          averagePrice,
          lastPrice: decimal(field(row, 'last_price')),
          currency: 'INR',
        },
      ];
    });
  }
}

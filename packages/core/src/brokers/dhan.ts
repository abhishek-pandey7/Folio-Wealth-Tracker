import { BadRequestError, UpstreamError } from '../errors.js';
import { BrokerRequestError, call, decimal, type Fetch, field, istTimestamp, jwtExpiry, text } from './http.js';
import type { BrokerAdapter, BrokerHolding, BrokerSession, LoginStart } from './types.js';

const AUTH = 'https://auth.dhan.co';
const API = 'https://api.dhan.co/v2';

export interface DhanConfig {
  clientId: string;
  apiKey: string;
  apiSecret: string;
}

// DH-901: token invalid or expired. DH-907: no data (an account with no holdings).
const errorCode = (body: unknown) => text(body, 'errorCode');

/**
 * Dhan's API key login (docs.dhanhq.co, Authentication): Folio opens a consent
 * session with the key and secret, the owner logs in on Dhan's page, and Dhan
 * redirects back with a tokenId that Folio exchanges for a 24-hour token.
 * Holdings come from GET /v2/holdings. Dhan only accepts orders from a
 * whitelisted static IP, which a Cloudflare deployment does not have.
 */
export class DhanAdapter implements BrokerAdapter {
  readonly id = 'dhan' as const;
  readonly login = 'redirect' as const;

  constructor(
    private readonly config: DhanConfig,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  private appHeaders() {
    return { accept: 'application/json', app_id: this.config.apiKey, app_secret: this.config.apiSecret };
  }

  async startLogin(): Promise<LoginStart> {
    const body = await call(this.fetchFn, {
      broker: 'Dhan',
      url: `${AUTH}/app/generate-consent?client_id=${encodeURIComponent(this.config.clientId)}`,
      init: { method: 'POST', headers: this.appHeaders() },
    });
    const consentAppId = text(body, 'consentAppId');
    if (!consentAppId) throw new UpstreamError('Dhan did not start a login session');
    return { url: `${AUTH}/login/consentApp-login?consentAppId=${encodeURIComponent(consentAppId)}` };
  }

  async completeLogin(params: Record<string, string>): Promise<BrokerSession> {
    const tokenId = params.tokenId;
    if (!tokenId) throw new BadRequestError('Dhan did not send a login token back');
    const body = await call(this.fetchFn, {
      broker: 'Dhan',
      url: `${AUTH}/app/consumeApp-consent?tokenId=${encodeURIComponent(tokenId)}`,
      init: { method: 'POST', headers: this.appHeaders() },
    });
    const accessToken = text(body, 'accessToken');
    if (!accessToken) throw new UpstreamError('Dhan did not return an access token');
    return {
      accessToken,
      expiresAt:
        jwtExpiry(accessToken) ?? istTimestamp(text(body, 'expiryTime')) ?? new Date(Date.now() + 24 * 3_600_000),
      userName: text(body, 'dhanClientName') ?? text(body, 'dhanClientId'),
    };
  }

  async holdings(accessToken: string): Promise<BrokerHolding[]> {
    let body: unknown;
    try {
      body = await call(this.fetchFn, {
        broker: 'Dhan',
        url: `${API}/holdings`,
        init: { headers: { accept: 'application/json', 'access-token': accessToken } },
        sessionError: (status, b) => status === 401 || status === 403 || errorCode(b) === 'DH-901',
      });
    } catch (error) {
      if (error instanceof BrokerRequestError && errorCode(error.body) === 'DH-907') return [];
      throw error;
    }
    if (!Array.isArray(body)) return [];
    return body.flatMap((row): BrokerHolding[] => {
      const symbol = text(row, 'tradingSymbol');
      const quantity = decimal(field(row, 'totalQty'));
      const averagePrice = decimal(field(row, 'avgCostPrice'));
      if (!symbol || !quantity?.greaterThan(0) || !averagePrice) return [];
      return [
        {
          tradingSymbol: symbol,
          exchange: text(row, 'exchange') ?? 'NSE',
          isin: text(row, 'isin'),
          name: null,
          quantity,
          averagePrice,
          lastPrice: decimal(field(row, 'lastTradedPrice')),
          currency: 'INR',
        },
      ];
    });
  }
}

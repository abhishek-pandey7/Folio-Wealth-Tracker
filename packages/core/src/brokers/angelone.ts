import { BadRequestError, UpstreamError } from '../errors.js';
import { BrokerRequestError, call, decimal, type Fetch, field, jwtExpiry, nextIstTime, text } from './http.js';
import type { BrokerAdapter, BrokerHolding, BrokerSession } from './types.js';

const API = 'https://apiconnect.angelone.in/rest';

export interface AngelOneConfig {
  apiKey: string;
}

const CLIENT_CODE = /^[A-Za-z0-9]{1,20}$/;
const PIN = /^\d{4,6}$/;
const TOTP = /^\d{6}$/;

/**
 * Angel One SmartAPI, as its official Python SDK (angel-one/smartapi-python)
 * calls it. Individual apps log in with the client code, PIN and the current
 * TOTP code; Folio passes them through once and keeps only the session token.
 * Holdings: GET /secure/angelbroking/portfolio/v1/getHolding.
 */
export class AngelOneAdapter implements BrokerAdapter {
  readonly id = 'angelone' as const;
  readonly login = 'credentials' as const;

  constructor(
    private readonly config: AngelOneConfig,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  // SmartAPI requires these on every call; the SDK sends the machine's IPs and MAC address.
  private headers(token?: string): Record<string, string> {
    return {
      'content-type': 'application/json',
      accept: 'application/json',
      'X-UserType': 'USER',
      'X-SourceID': 'WEB',
      'X-ClientLocalIP': '127.0.0.1',
      'X-ClientPublicIP': '127.0.0.1',
      'X-MACAddress': '00:00:00:00:00:00',
      'X-PrivateKey': this.config.apiKey,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
  }

  async completeLogin(params: Record<string, string>): Promise<BrokerSession> {
    const clientCode = params.clientCode?.trim() ?? '';
    const pin = params.pin?.trim() ?? '';
    const totp = params.totp?.trim() ?? '';
    if (!CLIENT_CODE.test(clientCode)) throw new BadRequestError('Enter your Angel One client code');
    if (!PIN.test(pin)) throw new BadRequestError('Enter your Angel One PIN (4 to 6 digits)');
    if (!TOTP.test(totp)) throw new BadRequestError('Enter the 6-digit code from your authenticator app');

    const body = await call(this.fetchFn, {
      broker: 'Angel One',
      url: `${API}/auth/angelbroking/user/v1/loginByPassword`,
      init: {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ clientcode: clientCode, password: pin, totp }),
      },
    });
    const accessToken = text(field(body, 'data'), 'jwtToken');
    if (field(body, 'status') !== true || !accessToken) {
      throw new BadRequestError(`Angel One rejected the login: ${text(body, 'message') ?? 'unknown reason'}`);
    }
    return {
      accessToken: accessToken.replace(/^Bearer\s+/i, ''),
      expiresAt: jwtExpiry(accessToken.replace(/^Bearer\s+/i, '')) ?? nextIstTime(0, 0),
      userName: clientCode.toUpperCase(),
    };
  }

  async holdings(accessToken: string): Promise<BrokerHolding[]> {
    const body = await call(this.fetchFn, {
      broker: 'Angel One',
      url: `${API}/secure/angelbroking/portfolio/v1/getHolding`,
      init: { headers: this.headers(accessToken) },
    });
    // SmartAPI reports some failures, an expired token among them, with HTTP 200 and status false.
    if (field(body, 'status') === false) {
      const message = text(body, 'message') ?? 'request failed';
      const expired = /token|session|unauthori[sz]ed/i.test(`${message} ${text(body, 'errorcode') ?? ''}`);
      throw new BrokerRequestError(`Angel One: ${message}`, 200, body, expired);
    }
    const rows = field(body, 'data');
    if (rows === null || rows === undefined) return [];
    if (!Array.isArray(rows)) throw new UpstreamError('Angel One returned holdings in an unexpected shape');
    return rows.flatMap((row): BrokerHolding[] => {
      const symbol = text(row, 'tradingsymbol');
      const quantity = decimal(field(row, 'quantity'));
      const averagePrice = decimal(field(row, 'averageprice'));
      if (!symbol || !quantity?.greaterThan(0) || !averagePrice) return [];
      return [
        {
          tradingSymbol: symbol,
          exchange: text(row, 'exchange') ?? 'NSE',
          isin: text(row, 'isin'),
          name: null,
          quantity,
          averagePrice,
          lastPrice: decimal(field(row, 'ltp')),
          currency: 'INR',
        },
      ];
    });
  }
}

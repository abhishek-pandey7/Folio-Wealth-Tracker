import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BadRequestError } from '../errors.js';
import { AngelOneAdapter } from './angelone.js';
import { DhanAdapter } from './dhan.js';
import { BrokerRequestError, type Fetch } from './http.js';
import { IndmoneyAdapter } from './indmoney.js';
import { UpstoxAdapter } from './upstox.js';
import { ZerodhaAdapter } from './zerodha.js';

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** A fetch that answers from a queue and records every request, so tests can check exactly what was sent. */
function fakeFetch(...responses: Array<{ status?: number; body?: unknown }>) {
  const sent: Sent[] = [];
  const fn: Fetch = async (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    sent.push({ url: String(input), method: init?.method ?? 'GET', headers, body: String(init?.body ?? '') });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request to ${String(input)}`);
    return new Response(JSON.stringify(next.body ?? null), { status: next.status ?? 200 });
  };
  return { fn, sent };
}

/** Adapters may only call login, token and holdings endpoints: nothing that could trade. */
function assertReadOnly(sent: Sent[]) {
  // Paths only: Zerodha's API host is api.kite.trade.
  for (const { url } of sent) {
    expect(new URL(url).pathname).not.toMatch(/order|trade|gtt|position|exit|convert|margin/i);
  }
}

const jwt = (exp: number) => `x.${btoa(JSON.stringify({ exp })).replace(/=+$/, '')}.y`;

describe('DhanAdapter', () => {
  const config = { clientId: '1000000001', apiKey: 'key', apiSecret: 'secret' };

  it('opens a consent session and sends the browser to Dhan', async () => {
    const { fn, sent } = fakeFetch({ body: { consentAppId: 'abc-123', status: 'success' } });
    const start = await new DhanAdapter(config, fn).startLogin();
    expect(start.url).toBe('https://auth.dhan.co/login/consentApp-login?consentAppId=abc-123');
    expect(sent[0]).toMatchObject({
      url: 'https://auth.dhan.co/app/generate-consent?client_id=1000000001',
      method: 'POST',
      headers: { app_id: 'key', app_secret: 'secret' },
    });
  });

  it('exchanges the tokenId for a token and reads its expiry from the JWT', async () => {
    const exp = 1_900_000_000;
    const { fn, sent } = fakeFetch({ body: { accessToken: jwt(exp), dhanClientName: 'A PANDEY' } });
    const session = await new DhanAdapter(config, fn).completeLogin({ tokenId: 't-1' });
    expect(sent[0]?.url).toBe('https://auth.dhan.co/app/consumeApp-consent?tokenId=t-1');
    expect(session.expiresAt.getTime()).toBe(exp * 1000);
    expect(session.userName).toBe('A PANDEY');
  });

  it('rejects a callback without a tokenId', async () => {
    await expect(new DhanAdapter(config, fakeFetch().fn).completeLogin({})).rejects.toBeInstanceOf(BadRequestError);
  });

  it('maps holdings and skips sold-out rows', async () => {
    const { fn, sent } = fakeFetch({
      body: [
        {
          exchange: 'ALL',
          tradingSymbol: 'TCS',
          isin: 'IN1',
          totalQty: 5,
          avgCostPrice: 3500.5,
          lastTradedPrice: 4100,
        },
        { exchange: 'NSE', tradingSymbol: 'SOLD', totalQty: 0, avgCostPrice: 10 },
      ],
    });
    const holdings = await new DhanAdapter(config, fn).holdings('tok');
    expect(sent[0]).toMatchObject({ url: 'https://api.dhan.co/v2/holdings', headers: { 'access-token': 'tok' } });
    expect(holdings).toHaveLength(1);
    expect(holdings[0]).toMatchObject({ tradingSymbol: 'TCS', exchange: 'ALL', currency: 'INR' });
    expect(holdings[0]?.quantity.toString()).toBe('5');
    expect(holdings[0]?.averagePrice.toString()).toBe('3500.5');
    expect(holdings[0]?.lastPrice?.toString()).toBe('4100');
    assertReadOnly(sent);
  });

  it('treats DH-907 (no data) as no holdings and DH-901 as an ended session', async () => {
    const empty = fakeFetch({ status: 400, body: { errorType: 'Data_Error', errorCode: 'DH-907' } });
    expect(await new DhanAdapter(config, empty.fn).holdings('tok')).toEqual([]);

    const expired = fakeFetch({ status: 400, body: { errorType: 'Invalid_Authentication', errorCode: 'DH-901' } });
    const error = await new DhanAdapter(config, expired.fn).holdings('tok').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BrokerRequestError);
    expect((error as BrokerRequestError).sessionExpired).toBe(true);
  });
});

describe('ZerodhaAdapter', () => {
  const config = { apiKey: 'kitekey', apiSecret: 'kitesecret' };

  it('passes the state through redirect_params', async () => {
    const { url } = await new ZerodhaAdapter(config, fakeFetch().fn).startLogin('', 'state123state123');
    expect(url).toBe(
      'https://kite.zerodha.com/connect/login?v=3&api_key=kitekey&redirect_params=state%3Dstate123state123',
    );
  });

  it('signs the token exchange with SHA-256 of key, request token and secret', async () => {
    const { fn, sent } = fakeFetch({
      body: { status: 'success', data: { access_token: 'acc', user_name: 'Abhishek' } },
    });
    const session = await new ZerodhaAdapter(config, fn).completeLogin({ request_token: 'req', status: 'success' });
    const form = new URLSearchParams(sent[0]?.body);
    expect(sent[0]).toMatchObject({ url: 'https://api.kite.trade/session/token', method: 'POST' });
    expect(sent[0]?.headers['x-kite-version']).toBe('3');
    expect(form.get('checksum')).toBe(createHash('sha256').update('kitekeyreqkitesecret').digest('hex'));
    expect(session).toMatchObject({ accessToken: 'acc', userName: 'Abhishek' });
  });

  it('refuses a login that did not succeed', async () => {
    await expect(
      new ZerodhaAdapter(config, fakeFetch().fn).completeLogin({ request_token: 'r', status: 'cancelled' }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('adds T1 units to delivered ones', async () => {
    const row = {
      tradingsymbol: 'INFY',
      exchange: 'NSE',
      quantity: 10,
      t1_quantity: 2,
      average_price: 1500,
      last_price: 1600,
    };
    const { fn, sent } = fakeFetch({ body: { status: 'success', data: [row] } });
    const [holding] = await new ZerodhaAdapter(config, fn).holdings('acc');
    expect(sent[0]?.headers.authorization).toBe('token kitekey:acc');
    expect(holding?.quantity.toString()).toBe('12');
    assertReadOnly(sent);
  });
});

describe('UpstoxAdapter', () => {
  const config = { apiKey: 'upkey', apiSecret: 'upsecret' };
  const redirect = 'https://folio.example/connect/upstox';

  it('builds the OAuth dialog URL and exchanges the code with the same redirect URI', async () => {
    const { url } = await new UpstoxAdapter(config, fakeFetch().fn).startLogin(redirect, 'abcabcabcabcabcabc');
    const dialog = new URL(url);
    expect(dialog.origin + dialog.pathname).toBe('https://api.upstox.com/v2/login/authorization/dialog');
    expect(dialog.searchParams.get('redirect_uri')).toBe(redirect);
    expect(dialog.searchParams.get('state')).toBe('abcabcabcabcabcabc');

    const { fn, sent } = fakeFetch({ body: { access_token: 'tok', user_name: 'A' } });
    await new UpstoxAdapter(config, fn).completeLogin({ code: 'c1' }, redirect);
    const form = new URLSearchParams(sent[0]?.body);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('redirect_uri')).toBe(redirect);
    expect(form.get('client_secret')).toBe('upsecret');
  });

  it('maps long-term holdings, including the company name', async () => {
    const row = {
      trading_symbol: 'HDFCBANK',
      exchange: 'NSE',
      company_name: 'HDFC BANK LTD.',
      quantity: 3,
      average_price: 1500.25,
    };
    const { fn, sent } = fakeFetch({ body: { status: 'success', data: [row] } });
    const [holding] = await new UpstoxAdapter(config, fn).holdings('tok');
    expect(sent[0]?.headers.authorization).toBe('Bearer tok');
    expect(holding).toMatchObject({ tradingSymbol: 'HDFCBANK', name: 'HDFC BANK LTD.', lastPrice: null });
    assertReadOnly(sent);
  });
});

describe('AngelOneAdapter', () => {
  const adapter = (fn: Fetch) => new AngelOneAdapter({ apiKey: 'smartkey' }, fn);

  it('validates the form before calling Angel One', async () => {
    const { fn, sent } = fakeFetch();
    await expect(adapter(fn).completeLogin({ clientCode: 'A1', pin: '12', totp: '123456' })).rejects.toThrow('PIN');
    await expect(adapter(fn).completeLogin({ clientCode: 'A1', pin: '1234', totp: '12' })).rejects.toThrow('6-digit');
    expect(sent).toHaveLength(0);
  });

  it('logs in with client code, PIN and TOTP and keeps only the JWT', async () => {
    const { fn, sent } = fakeFetch({ body: { status: true, data: { jwtToken: `Bearer ${jwt(1_900_000_000)}` } } });
    const session = await adapter(fn).completeLogin({ clientCode: 'a123', pin: '1234', totp: '654321' });
    expect(JSON.parse(sent[0]?.body ?? '')).toEqual({ clientcode: 'a123', password: '1234', totp: '654321' });
    expect(sent[0]?.headers['x-privatekey']).toBe('smartkey');
    expect(session.accessToken.startsWith('Bearer')).toBe(false);
    expect(session.expiresAt.getTime()).toBe(1_900_000_000_000);
    expect(session.userName).toBe('A123');
  });

  it('turns a refused login into a clear error', async () => {
    const { fn } = fakeFetch({ body: { status: false, message: 'Invalid totp' } });
    await expect(adapter(fn).completeLogin({ clientCode: 'A1', pin: '1234', totp: '000000' })).rejects.toThrow(
      'Invalid totp',
    );
  });

  it('reads holdings and spots an expired token reported with HTTP 200', async () => {
    const row = { tradingsymbol: 'TATASTEEL-EQ', exchange: 'NSE', quantity: 4, averageprice: 111.87, ltp: 130.15 };
    const ok = fakeFetch({ body: { status: true, data: [row] } });
    const [holding] = await adapter(ok.fn).holdings('jwt');
    expect(holding).toMatchObject({ tradingSymbol: 'TATASTEEL-EQ' });
    expect(holding?.lastPrice?.toString()).toBe('130.15');
    assertReadOnly(ok.sent);

    const none = fakeFetch({ body: { status: true, data: null } });
    expect(await adapter(none.fn).holdings('jwt')).toEqual([]);

    const expired = fakeFetch({ body: { status: false, message: 'Invalid Token', errorcode: 'AG8001' } });
    const error = await adapter(expired.fn)
      .holdings('jwt')
      .catch((e: unknown) => e);
    expect((error as BrokerRequestError).sessionExpired).toBe(true);
  });
});

describe('IndmoneyAdapter', () => {
  it('registers itself, asks only for portfolio:read, and uses PKCE', async () => {
    const { fn, sent } = fakeFetch({ body: { client_id: 'cid', client_secret: 'csec' } });
    const { url, carry } = await new IndmoneyAdapter(fn).startLogin(
      'https://folio.example/connect/indmoney',
      'st'.repeat(9),
    );
    expect(sent[0]?.url).toBe('https://mcp.indmoney.com/register');
    expect(JSON.parse(sent[0]?.body ?? '').scope).toBe('portfolio:read');
    const authorize = new URL(url);
    expect(authorize.searchParams.get('scope')).toBe('portfolio:read');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    const { verifier } = JSON.parse(carry ?? '') as { verifier: string };
    expect(authorize.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(verifier).digest('base64url'),
    );
  });

  it('exchanges the code with the verifier and keeps the refresh token', async () => {
    const carry = JSON.stringify({ clientId: 'cid', clientSecret: 'csec', verifier: 'v' });
    const { fn, sent } = fakeFetch({ body: { access_token: 'a1', refresh_token: 'r1', expires_in: 3600 } });
    const session = await new IndmoneyAdapter(fn).completeLogin({ code: 'c' }, 'https://folio.example/cb', carry);
    const form = new URLSearchParams(sent[0]?.body);
    expect(form.get('code_verifier')).toBe('v');
    expect(form.get('client_secret')).toBe('csec');
    expect(JSON.parse(session.refresh ?? '')).toEqual({ clientId: 'cid', clientSecret: 'csec', refreshToken: 'r1' });
  });

  it('keeps the refresh token when a refresh does not rotate it, and reports invalid_grant as ended', async () => {
    const saved = JSON.stringify({ clientId: 'cid', clientSecret: null, refreshToken: 'r1' });
    const same = fakeFetch({ body: { access_token: 'a2', expires_in: 60 } });
    const renewed = await new IndmoneyAdapter(same.fn).refresh(saved);
    expect(JSON.parse(renewed.refresh ?? '').refreshToken).toBe('r1');

    const refused = fakeFetch({ status: 400, body: { error: 'invalid_grant' } });
    const error = await new IndmoneyAdapter(refused.fn).refresh(saved).catch((e: unknown) => e);
    expect((error as BrokerRequestError).sessionExpired).toBe(true);
  });
});

import { Decimal } from '@folio/shared';
import { describe, expect, it } from 'vitest';
import { TokenCipher } from './cipher.js';
import { decimal, istTimestamp, jwtExpiry, messageOf, nextIstTime } from './http.js';
import { match } from './service.js';
import { assetClassOf, yahooSymbol } from './symbols.js';
import type { BrokerHolding } from './types.js';

describe('yahooSymbol', () => {
  it('maps Indian listings to .NS, or .BO when only on BSE', () => {
    expect(yahooSymbol('RELIANCE', 'NSE')).toBe('RELIANCE.NS');
    expect(yahooSymbol('TCS', 'ALL')).toBe('TCS.NS');
    expect(yahooSymbol('RELIANCE', 'BSE')).toBe('RELIANCE.BO');
    expect(yahooSymbol('m&m', 'NSE')).toBe('M&M.NS');
  });

  it('drops NSE series suffixes', () => {
    expect(yahooSymbol('TATASTEEL-EQ', 'NSE')).toBe('TATASTEEL.NS');
    expect(yahooSymbol('BAJAJ-AUTO', 'NSE')).toBe('BAJAJ-AUTO.NS');
  });

  it('writes US share classes the way Yahoo does', () => {
    expect(yahooSymbol('AAPL', 'US')).toBe('AAPL');
    expect(yahooSymbol('BRK.B', 'NYSE')).toBe('BRK-B');
  });

  it('refuses anything that cannot be a listed symbol', () => {
    expect(yahooSymbol('', 'NSE')).toBeNull();
    expect(yahooSymbol('NOT A SYMBOL', 'NSE')).toBeNull();
  });
});

describe('assetClassOf', () => {
  it('spots gold bonds and ETFs from the symbol', () => {
    expect(assetClassOf('SGBAUG28V.NS')).toBe('gold');
    expect(assetClassOf('NIFTYBEES.NS')).toBe('etf');
    expect(assetClassOf('SETFNIF50.NS')).toBe('etf');
    expect(assetClassOf('INFY.NS')).toBe('equity');
  });
});

describe('time helpers', () => {
  it('finds the next 6 AM in India', () => {
    // 2026-11-26 10:00 UTC is 15:30 IST, so the next 6 AM IST is 2026-11-27 00:30 UTC.
    expect(nextIstTime(6, 0, new Date('2026-11-26T10:00:00Z')).toISOString()).toBe('2026-11-27T00:30:00.000Z');
    // 2026-11-26 00:00 UTC is 05:30 IST, so 6 AM IST is half an hour away.
    expect(nextIstTime(6, 0, new Date('2026-11-26T00:00:00Z')).toISOString()).toBe('2026-11-26T00:30:00.000Z');
  });

  it('reads timestamps without a zone as Indian time', () => {
    expect(istTimestamp('2025-01-01T09:00:00.000')?.toISOString()).toBe('2025-01-01T03:30:00.000Z');
    expect(istTimestamp('2025-01-01T09:00:00Z')?.toISOString()).toBe('2025-01-01T09:00:00.000Z');
    expect(istTimestamp('nonsense')).toBeNull();
  });

  it('reads the exp claim of a JWT and ignores anything else', () => {
    const token = `h.${btoa(JSON.stringify({ exp: 1_800_000_000 }))}.s`;
    expect(jwtExpiry(token)?.getTime()).toBe(1_800_000_000_000);
    expect(jwtExpiry('not-a-jwt')).toBeNull();
  });
});

describe('broker response helpers', () => {
  it('parses broker numbers without floating point drift', () => {
    expect(decimal(0.1)?.plus(0.2).toString()).toBe('0.3');
    expect(decimal('12.97')?.toString()).toBe('12.97');
    expect(decimal('abc')).toBeNull();
    expect(decimal(undefined)).toBeNull();
  });

  it('finds the error message whichever field a broker uses', () => {
    expect(messageOf({ errorMessage: 'Token expired' })).toBe('Token expired');
    expect(messageOf({ error: { message: 'Bad request' } })).toBe('Bad request');
    expect(messageOf({ errors: [{ message: 'Invalid code' }] })).toBe('Invalid code');
    expect(messageOf('plain')).toBeUndefined();
  });
});

describe('TokenCipher', () => {
  it('round-trips, uses a fresh IV each time, and fails closed on tampering or a different key', async () => {
    const cipher = await TokenCipher.fromSecret('a'.repeat(43));
    const a = await cipher.encrypt('session-token');
    const b = await cipher.encrypt('session-token');
    expect(a).not.toBe(b);
    expect(await cipher.decrypt(a)).toBe('session-token');

    const flipped = `${a.slice(0, -4)}${a.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA'}`;
    expect(await cipher.decrypt(flipped)).toBeNull();
    expect(await (await TokenCipher.fromSecret('b'.repeat(43))).decrypt(a)).toBeNull();
    expect(await cipher.decrypt('%%%')).toBeNull();
  });
});

describe('match', () => {
  const holding = (over: Partial<BrokerHolding>): BrokerHolding => ({
    tradingSymbol: 'TCS',
    exchange: 'NSE',
    isin: null,
    name: null,
    quantity: new Decimal(1),
    averagePrice: new Decimal(100),
    lastPrice: null,
    currency: 'INR',
    ...over,
  });

  it('merges a symbol listed twice into one position with a weighted average cost', () => {
    const { matched, unmatched } = match([
      holding({ quantity: new Decimal(2), averagePrice: new Decimal(100) }),
      holding({
        tradingSymbol: 'TCS-EQ',
        quantity: new Decimal(1),
        averagePrice: new Decimal(130),
        lastPrice: new Decimal(140),
      }),
      holding({ tradingSymbol: '???' }),
    ]);
    expect(unmatched).toEqual(['???']);
    expect(matched).toHaveLength(1);
    expect(matched[0]?.quantity.toString()).toBe('3');
    expect(matched[0]?.cost.dividedBy(matched[0].quantity).toString()).toBe('110');
    expect(matched[0]?.lastPrice?.toString()).toBe('140');
  });
});

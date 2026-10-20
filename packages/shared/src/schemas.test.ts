import { describe, expect, it } from 'vitest';
import { BatchQuotesSchema, QuoteSchema, SymbolSchema } from './schemas.js';

// Captured from the Go gateway in live mode: the contract both sides must keep.
const gatewayQuote = {
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

describe('market data contracts', () => {
  it('accepts a real gateway quote', () => {
    expect(QuoteSchema.parse(gatewayQuote)).toEqual(gatewayQuote);
  });

  it('rejects prices sent as JSON numbers', () => {
    expect(QuoteSchema.safeParse({ ...gatewayQuote, price: 1202 }).success).toBe(false);
  });

  it('rejects currencies the portfolio math does not support', () => {
    expect(QuoteSchema.safeParse({ ...gatewayQuote, currency: 'JPY' }).success).toBe(false);
  });

  it('accepts a batch with per-symbol errors', () => {
    const batch = { quotes: [gatewayQuote], errors: { 'NOPE.NS': 'not found' } };
    expect(BatchQuotesSchema.parse(batch).errors).toEqual({ 'NOPE.NS': 'not found' });
  });
});

describe('SymbolSchema', () => {
  it.each(['AAPL', 'reliance.ns', '500325.BO', 'M&M.NS', '^NSEI', ' tcs.ns '])('accepts %s', (symbol) => {
    expect(SymbolSchema.safeParse(symbol).success).toBe(true);
  });

  it.each(['', 'DROP TABLE;', '../etc/passwd', 'A'.repeat(25)])('rejects %j', (symbol) => {
    expect(SymbolSchema.safeParse(symbol).success).toBe(false);
  });

  it('normalizes case and whitespace', () => {
    expect(SymbolSchema.parse(' tcs.ns ')).toBe('TCS.NS');
  });
});

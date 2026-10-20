import { describe, expect, it } from 'vitest';
import { BatchQuotesSchema, FundScreenResultSchema, QuoteSchema, ScreenResultSchema, SymbolSchema } from './schemas.js';

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

describe('analytics contracts', () => {
  // Captured from the live gateway (trimmed to one row).
  const screen = {
    universe: {
      id: 'in-large',
      name: 'India large caps',
      description: 'The biggest, most traded companies on the NSE.',
      group: 'India',
      region: 'IN',
      count: 59,
    },
    period: '1y',
    sort: 'return',
    order: 'best',
    total: 59,
    rows: [
      {
        symbol: 'SHRIRAMFIN.NS',
        name: 'Shriram Finance Limited',
        exchange: 'NSE',
        currency: 'INR',
        sector: 'Banks and financials',
        price: '926.5',
        high52w: 1153.7,
        low52w: 678.1,
        fromHigh52w: -19.69,
        metrics: {
          asOf: '2026-10-19',
          returns: {
            '1d': -1.43,
            '1m': -8.27,
            '1w': -0.31,
            '1y': 38.77,
            '3m': -10.47,
            '3y': 37.23,
            '5y': 28.81,
            '6m': -10.15,
            ytd: -6.47,
          },
          volatility1y: 36.55,
          maxDrawdown1y: -21.05,
          riskAdjusted1y: 1.06,
          upMonths: 9,
          months: 12,
        },
        changePercent: -1.43,
      },
    ],
    unavailable: {},
  };

  it('accepts a real screener response', () => {
    expect(ScreenResultSchema.parse(screen).rows[0]?.metrics.returns['5y']).toBe(28.81);
  });

  it('accepts null statistics for short histories', () => {
    const young = JSON.parse(JSON.stringify(screen)) as typeof screen;
    const row = young.rows[0] as unknown as {
      metrics: { returns: Record<string, number | null>; volatility1y: number | null };
    };
    row.metrics.returns['5y'] = null;
    row.metrics.volatility1y = null;
    expect(ScreenResultSchema.safeParse(young).success).toBe(true);
  });

  it('rejects a returns map missing a period', () => {
    const broken = JSON.parse(JSON.stringify(screen)) as typeof screen;
    const returns: Record<string, number> = broken.rows[0]?.metrics.returns ?? {};
    delete returns['3y'];
    expect(ScreenResultSchema.safeParse(broken).success).toBe(false);
  });

  it('accepts a real fund screener response', () => {
    const fundScreen = {
      category: {
        id: 'large-cap',
        name: 'Large cap',
        description: 'At least 80% in the top 100 companies.',
        count: 34,
      },
      period: '3y',
      sort: 'return',
      order: 'best',
      total: 34,
      unavailable: {},
      rows: [
        {
          schemeCode: '118870',
          name: 'Taurus Large Cap Fund - Direct Plan - Growth',
          fundHouse: 'Taurus Mutual Fund',
          category: 'Equity Scheme - Large Cap Fund',
          nav: '177.76',
          navDate: '2026-10-19',
          metrics: {
            asOf: '2026-10-19',
            returns: {
              '1d': -1.23,
              '1m': 0.22,
              '1w': 1.46,
              '1y': 4.43,
              '3m': 3.6,
              '3y': 13.04,
              '5y': 9.45,
              '6m': 6.86,
              ytd: 3.32,
            },
            volatility1y: 13.28,
            maxDrawdown1y: -12.49,
            riskAdjusted1y: 0.33,
            upMonths: 7,
            months: 12,
          },
        },
      ],
    };
    expect(FundScreenResultSchema.parse(fundScreen).rows).toHaveLength(1);
  });
});

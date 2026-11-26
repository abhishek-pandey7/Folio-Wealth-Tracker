import { describe, expect, it } from 'vitest';
import { marketOf, marketOpen, marketsOpen } from './hours.js';

const at = (iso: string) => new Date(iso);

describe('market hours', () => {
  it('knows NSE hours in UTC', () => {
    expect(marketOpen('IN', at('2026-11-26T03:44:00Z'))).toBe(false); // 09:14 IST
    expect(marketOpen('IN', at('2026-11-26T03:45:00Z'))).toBe(true); // 09:15 IST
    expect(marketOpen('IN', at('2026-11-26T10:00:00Z'))).toBe(true); // 15:30 IST
    expect(marketOpen('IN', at('2026-11-26T10:01:00Z'))).toBe(false);
  });

  it('covers NYSE hours in both summer and winter time', () => {
    expect(marketOpen('US', at('2026-07-01T13:30:00Z'))).toBe(true); // 09:30 EDT
    expect(marketOpen('US', at('2026-12-01T20:59:00Z'))).toBe(true); // 15:59 EST
    expect(marketOpen('US', at('2026-12-01T21:01:00Z'))).toBe(false);
  });

  it('is closed at weekends', () => {
    expect(marketsOpen(at('2026-11-28T05:00:00Z'))).toBe(false); // Saturday
    expect(marketsOpen(at('2026-11-29T15:00:00Z'))).toBe(false); // Sunday
    expect(marketsOpen(at('2026-11-27T05:00:00Z'))).toBe(true); // Friday, NSE
  });

  it('tells Indian listings and indices from US ones', () => {
    expect(marketOf('RELIANCE.NS')).toBe('IN');
    expect(marketOf('500325.BO')).toBe('IN');
    expect(marketOf('^NSEI')).toBe('IN');
    expect(marketOf('^BSESN')).toBe('IN');
    expect(marketOf('^CNXIT')).toBe('IN');
    expect(marketOf('AAPL')).toBe('US');
    expect(marketOf('^GSPC')).toBe('US');
  });
});

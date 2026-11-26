import { SymbolSchema } from '@folio/shared';
import { describe, expect, it } from 'vitest';
import { allSymbols, curatedSymbols, sectorOf, universe, universes } from './universe.js';

describe('universes', () => {
  it('lists only valid, normalized symbols, once per universe, with matching counts', () => {
    for (const u of universes()) {
      const { symbols } = universe(u.id) ?? { symbols: [] };
      expect(new Set(symbols).size, u.id).toBe(symbols.length);
      expect(u.count, u.id).toBe(symbols.length);
      expect(u.count, u.id).toBeGreaterThan(0);
      for (const s of symbols) expect(SymbolSchema.parse(s), `${u.id}: ${s}`).toBe(s);
    }
  });

  it('has unique ids', () => {
    const ids = universes().map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes the Nifty 500 and the S&P 500', () => {
    const nifty = universe('in-nifty500');
    const sp = universe('us-sp500');
    expect(nifty?.symbols.length).toBeGreaterThan(480);
    expect(sp?.symbols.length).toBeGreaterThan(480);
    expect(nifty?.symbols).toContain('RELIANCE.NS');
    expect(sp?.symbols).toContain('BRK-B'); // Yahoo's spelling of BRK.B
    expect(allSymbols().length).toBeGreaterThan(1000);
  });

  it('draws sector lists from the index members, keeping the curated sector where they overlap', () => {
    const it = universe('in-sector-it')?.symbols ?? [];
    expect(it).toContain('PERSISTENT.NS'); // curated mid cap
    expect(it).toContain('ZENSARTECH.NS'); // index member only
    for (const s of it) expect(sectorOf(s), s).toBe('IT services');
    // Alphabet is Communication Services in GICS; the curated list files it under technology.
    expect(sectorOf('GOOGL')).toBe('Technology');
    expect(universe('us-sector-industrials')?.symbols.length).toBeGreaterThan(50);
  });

  it('keeps the frequently refreshed set to the curated lists', () => {
    const curated = curatedSymbols();
    expect(curated.length).toBeLessThan(200);
    expect(curated).toContain('^NSEI');
    expect(curated).not.toContain('ZENSARTECH.NS');
  });
});

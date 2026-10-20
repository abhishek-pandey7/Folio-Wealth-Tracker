import { describe, expect, it } from 'vitest';
import { parseLines, START, wholeLines } from './amfi.js';
import { categoryOf, isDirectGrowth } from './universe.js';

// Trimmed from the real file, keeping every shape the parser must handle (same fixture as the Go tests).
const fixture =
  'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date\r\n' +
  ' \r\n' +
  'Open Ended Schemes(Equity Scheme - Large Cap Fund)\r\n' +
  ' \r\n' +
  'Axis Mutual Fund\r\n' +
  ' \r\n' +
  '120465;INF846K01DP8;-;Axis Large Cap Fund;Direct Plan;Growth Option;64.2100;17-Oct-2026\r\n' +
  '120466;INF846K01DQ6;-;Axis Large Cap Fund;Direct Plan;IDCW Option;21.50;17-Oct-2026\r\n' +
  '999001;-;-;Axis Wound Down Fund;Direct Plan;Growth Option;N.A.;01-Jan-2020\r\n' +
  'Open Ended Schemes(Equity Schemes - Small Cap Fund)\r\n' +
  'Nippon India Mutual Fund\r\n' +
  '118778;INF204K01K15;-;Nippon India Small Cap Fund - Direct Plan - Growth Option;174.2345;17-Oct-2026\r\n' +
  'Close Ended Schemes(Equity Scheme - Other)\r\n' +
  'Some Mutual Fund\r\n' +
  '555555;-;-;Some Fixed Term Plan;Direct Plan;Growth Option;10.0;17-Oct-2026\r\n';

describe('parseLines', () => {
  it('reads categories, fund houses and both row formats', () => {
    const { schemes } = parseLines(fixture, START);
    expect(schemes.map((s) => s.code)).toEqual(['120465', '120466', '118778']);
    expect(schemes[0]).toEqual({
      code: '120465',
      name: 'Axis Large Cap Fund',
      fundHouse: 'Axis Mutual Fund',
      heading: 'Equity Scheme - Large Cap Fund',
      plan: 'Direct Plan',
      option: 'Growth Option',
      nav: '64.21',
      navDate: '2026-10-17',
    });
    expect(schemes[2]).toMatchObject({
      plan: '',
      fundHouse: 'Nippon India Mutual Fund',
      heading: 'Equity Schemes - Small Cap Fund',
      nav: '174.2345',
    });
  });

  it('gives the same result however the file is chunked', () => {
    const bytes = new TextEncoder().encode(fixture);
    const whole = parseLines(fixture, START).schemes;
    for (const size of [7, 64, 100, 333]) {
      let cursor = START;
      let offset = 0;
      let window = size;
      const got = [];
      while (offset < bytes.length) {
        const end = Math.min(offset + window, bytes.length);
        const { text, used } = wholeLines(bytes.subarray(offset, end), end === bytes.length);
        if (used === 0) {
          window *= 2; // no whole line in this window yet
          continue;
        }
        const parsed = parseLines(text, cursor);
        got.push(...parsed.schemes);
        cursor = parsed.cursor;
        offset += used;
        window = size;
      }
      expect(got).toEqual(whole);
    }
  });

  it('never splits a multi-byte character', () => {
    const bytes = new TextEncoder().encode('Fund House ₹\nnext');
    const { text, used } = wholeLines(bytes, false);
    expect(text).toBe('Fund House ₹\n');
    expect(used).toBe(bytes.indexOf(0x0a) + 1);
  });
});

describe('fund categories', () => {
  it('match both AMFI spellings', () => {
    expect(categoryOf('Equity Scheme - Large Cap Fund', 'X')).toBe('large-cap');
    expect(categoryOf('Equity Schemes - Large Cap Fund', 'X')).toBe('large-cap');
    expect(categoryOf('Equity Scheme - Sectoral/ Thematic', 'X')).toBeUndefined();
  });

  it('filter index funds by scheme name', () => {
    expect(categoryOf('Other Scheme - Index Funds', 'UTI Nifty 50 Index Fund - Direct Plan - Growth')).toBe(
      'index-nifty50',
    );
    expect(categoryOf('Other Scheme - Index Funds', 'UTI Nifty Next 50 Index Fund')).toBeUndefined();
  });

  it('keep only Direct Growth plans', () => {
    expect(isDirectGrowth('Axis Large Cap Fund', 'Direct Plan', 'Growth Option')).toBe(true);
    expect(isDirectGrowth('Axis Large Cap Fund', 'Regular Plan', 'Growth Option')).toBe(false);
    expect(isDirectGrowth('Axis Large Cap Fund', 'Direct Plan', 'IDCW Option')).toBe(false);
    expect(isDirectGrowth('X Fund - Direct Plan - Growth - Bonus', '', '')).toBe(false);
  });
});

import { BadRequestError } from '@folio/core';
import type { Metrics } from '@folio/shared';
import { describe, expect, it } from 'vitest';
import { parseScreen, rank } from './screen.js';

const metrics = (r1y: number | null, vol: number | null = null): Metrics => ({
  asOf: '2026-10-19',
  returns: { '1d': null, '1w': null, '1m': null, '3m': null, '6m': null, ytd: null, '1y': r1y, '3y': null, '5y': null },
  volatility1y: vol,
  maxDrawdown1y: null,
  riskAdjusted1y: null,
  upMonths: 0,
  months: 0,
});

const rows = () => [
  { id: 'B', metrics: metrics(10, 30) },
  { id: 'A', metrics: metrics(null, 12) },
  { id: 'C', metrics: metrics(25, 20) },
  { id: 'D', metrics: metrics(10, null) },
];
const ids = (r: { id: string }[]) => r.map((x) => x.id);

describe('rank', () => {
  it('puts the best first, ties by id, and missing values last in both orders', () => {
    const best = parseScreen({ period: '1y' }, '1y');
    expect(ids(rank(rows(), (r) => r.id, best))).toEqual(['C', 'B', 'D', 'A']);
    expect(ids(rank(rows(), (r) => r.id, { ...best, order: 'worst' }))).toEqual(['B', 'D', 'C', 'A']);
  });

  it('treats the lowest volatility as best', () => {
    const s = parseScreen({ sort: 'volatility' }, '1y');
    expect(ids(rank(rows(), (r) => r.id, s))).toEqual(['A', 'C', 'B', 'D']);
  });
});

describe('parseScreen', () => {
  it('applies defaults', () => {
    expect(parseScreen({}, '3y')).toEqual({ period: '3y', sort: 'return', order: 'best', limit: 20 });
  });

  it.each([{ sort: 'vibes' }, { period: '10y' }, { limit: '1000' }, { limit: '2.5' }, { order: 'random' }])(
    'rejects %o',
    (q) => {
      expect(() => parseScreen(q, '1y')).toThrow(BadRequestError);
    },
  );
});

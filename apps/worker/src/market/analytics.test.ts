import { PERIODS } from '@folio/shared';
import { describe, expect, it } from 'vitest';
import { computeMetrics, maxDrawdown, type Point, periodReturn, toDate, upMonths, volatility } from './analytics.js';

// Ported from the Go gateway's analytics tests: the two implementations must agree.

const DAY = 86_400_000;
const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
const addYears = (ms: number, years: number, days = 0) => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear() + years, d.getUTCMonth(), d.getUTCDate() + days);
};

/** One point per weekday from start to end, valued f(years since start). */
function series(start: number, end: number, f: (years: number) => number): Point[] {
  const out: Point[] = [];
  for (let d = start; d <= end; d += DAY) {
    const weekday = new Date(d).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    out.push({ date: d, value: f((d - start) / DAY / 365.25) });
  }
  return out;
}

describe('periodReturn', () => {
  it('annualizes multi-year periods', () => {
    const points = series(day(2019, 1, 1), day(2025, 6, 30), (y) => 100 * 1.1 ** y);
    expect(periodReturn(points, '3y')).toBeCloseTo(10, 1);
    expect(periodReturn(points, '5y')).toBeCloseTo(10, 1);
    expect(Math.abs((periodReturn(points, '1y') ?? 0) - 10)).toBeLessThan(0.1);
  });

  it('cannot report periods longer than the series', () => {
    const points = series(day(2025, 1, 1), day(2025, 6, 30), () => 100);
    expect(periodReturn(points, '1y')).toBeNull();
    expect(periodReturn(points, '3m')).not.toBeNull();
  });

  it('accepts a series starting just after the period mark', () => {
    const end = day(2026, 10, 19);
    const points = series(addYears(end, -5, 3), end, (y) => 100 * 1.12 ** y);
    expect(periodReturn(points, '5y')).toBeCloseTo(12, 1);

    const tooShort = series(addYears(end, -5, 30), end, () => 100);
    expect(periodReturn(tooShort, '5y')).toBeNull();
  });

  it('measures ytd from the last close of the previous year', () => {
    const points = [
      { date: day(2024, 12, 30), value: 90 },
      { date: day(2024, 12, 31), value: 100 },
      { date: day(2025, 1, 2), value: 104 },
      { date: day(2025, 3, 3), value: 110 },
    ];
    expect(periodReturn(points, 'ytd')).toBeCloseTo(10, 9);
  });

  it('measures 1d against the previous point', () => {
    const points = [
      { date: day(2025, 3, 3), value: 200 },
      { date: day(2025, 3, 4), value: 190 },
    ];
    expect(periodReturn(points, '1d')).toBeCloseTo(-5, 9);
  });
});

describe('risk statistics', () => {
  it('gives steady growth near-zero volatility', () => {
    const points = series(day(2024, 1, 1), day(2025, 6, 30), (y) => 100 * 1.2 ** y);
    expect(volatility(points)).toBeLessThan(1);
  });

  it('gives a choppy series far higher volatility', () => {
    const smooth = series(day(2024, 1, 1), day(2025, 6, 30), (y) => 100 + 10 * y);
    let i = 0;
    const choppy = series(day(2024, 1, 1), day(2025, 6, 30), (y) => {
      i++;
      return 100 + 10 * y + (i % 2 === 0 ? 3 : -3);
    });
    expect(volatility(choppy) ?? 0).toBeGreaterThan((volatility(smooth) ?? 0) * 5);
  });

  it('finds the worst peak-to-trough fall', () => {
    const points = series(day(2024, 1, 1), day(2024, 12, 31), () => 100);
    [100, 120, 90, 130, 117].forEach((value, i) => {
      points.push({ date: day(2025, 1, 10 + i), value });
    });
    expect(maxDrawdown(points)).toBeCloseTo(-25, 9);
  });

  it('counts month-end closes for up months', () => {
    const closes = [100, 105, 101, 106, 110, 112, 108, 115, 118, 120, 125, 130];
    const points: Point[] = [{ date: day(2024, 12, 31), value: 95 }];
    closes.forEach((close, m) => {
      points.push({ date: day(2025, m + 1, 10), value: 1 });
      points.push({ date: day(2025, m + 1, 28), value: close });
    });
    expect(upMonths(points, 12)).toEqual({ up: 10, total: 12 });
  });

  it('needs a full year of history for 1-year statistics', () => {
    let i = 0;
    const young = series(day(2025, 6, 1), day(2025, 12, 31), () => 100 + (i++ % 5));
    expect(volatility(young)).toBeNull();
    expect(maxDrawdown(young)).toBeNull();
  });
});

describe('computeMetrics', () => {
  it('fills every period key', () => {
    const m = computeMetrics(series(day(2025, 1, 1), day(2025, 6, 30), (y) => 100 + y));
    expect(Object.keys(m.returns).sort()).toEqual([...PERIODS].sort());
    expect(m.returns['5y']).toBeNull();
    expect(m.asOf).toBe('2025-06-30');
  });

  it('defines risk-adjusted return as return over volatility', () => {
    let i = 0;
    const m = computeMetrics(series(day(2024, 1, 1), day(2025, 6, 30), (y) => 100 * 1.15 ** y + (i++ % 3)));
    expect(m.riskAdjusted1y).not.toBeNull();
    expect(m.riskAdjusted1y ?? 0).toBeCloseTo((m.returns['1y'] ?? 0) / (m.volatility1y ?? 1), 1);
  });

  it('parses ISO dates as UTC midnight', () => {
    expect(toDate('2026-10-20')).toBe(day(2026, 10, 20));
  });
});

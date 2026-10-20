import { describe, expect, it } from 'vitest';
import { monthlyRate, monthsBetween, nextSipDate, projectGoal, sipDueDates, sipPurchase } from './plan.js';

describe('sipDueDates', () => {
  it('lists one date a month from the first due date on or after the start', () => {
    expect(sipDueDates('2025-01-10', 5, '2025-05-04')).toEqual(['2025-02-05', '2025-03-05', '2025-04-05']);
    expect(sipDueDates('2025-01-05', 5, '2025-03-05')).toEqual(['2025-01-05', '2025-02-05', '2025-03-05']);
  });

  it('crosses year boundaries', () => {
    expect(sipDueDates('2024-11-20', 1, '2025-02-01')).toEqual(['2024-12-01', '2025-01-01', '2025-02-01']);
  });

  it('works in February for any allowed day', () => {
    expect(sipDueDates('2025-02-01', 28, '2025-03-01')).toEqual(['2025-02-28']);
  });

  it('is empty when the start is in the future', () => {
    expect(sipDueDates('2026-01-01', 5, '2025-12-31')).toEqual([]);
  });

  it('rejects days that do not exist in every month', () => {
    expect(() => sipDueDates('2025-01-01', 31, '2025-12-31')).toThrow(RangeError);
  });
});

describe('nextSipDate', () => {
  it('is today when due today, otherwise the next due date', () => {
    expect(nextSipDate('2024-01-05', 5, '2025-03-05')).toBe('2025-03-05');
    expect(nextSipDate('2024-01-05', 5, '2025-03-06')).toBe('2025-04-05');
  });

  it('waits for a future start', () => {
    expect(nextSipDate('2025-06-10', 5, '2025-03-01')).toBe('2025-07-05');
  });
});

describe('sipPurchase', () => {
  it('allots units rounded down and keeps the full amount as cost', () => {
    const p = sipPurchase('5000', '87.34651');

    expect(p.price.toString()).toBe('87.3465');
    expect(p.units.toString()).toBe('57.243'); // 5000 / 87.3465 = 57.2433...
    expect(p.units.times(p.price).plus(p.residual).toString()).toBe('5000');
    expect(p.residual.isNegative()).toBe(false);
  });
});

describe('goal maths', () => {
  it('compounds monthly to the stated annual rate', () => {
    expect((1 + monthlyRate(0.12)) ** 12 - 1).toBeCloseTo(0.12, 12);
  });

  it('counts whole months', () => {
    expect(monthsBetween('2025-01-15', '2026-01-15')).toBe(12);
    expect(monthsBetween('2025-01-15', '2026-01-14')).toBe(11);
    expect(monthsBetween('2026-01-15', '2025-01-15')).toBe(0);
  });

  it('grows a lump sum at the assumed return', () => {
    const { projected } = projectGoal({ current: 100_000, monthly: 0, annualReturn: 0.1, months: 24, target: 0 });
    expect(projected).toBeCloseTo(121_000, 6); // 1.1 squared
  });

  it('sums contributions exactly at zero return', () => {
    const { projected, requiredMonthly } = projectGoal({
      current: 0,
      monthly: 5_000,
      annualReturn: 0,
      months: 12,
      target: 120_000,
    });
    expect(projected).toBe(60_000);
    expect(requiredMonthly).toBe(10_000);
  });

  it('finds the monthly SIP that reaches the target, and reports zero when on track', () => {
    const plan = { current: 200_000, monthly: 0, annualReturn: 0.12, months: 60, target: 1_000_000 };
    const { requiredMonthly } = projectGoal(plan);

    // Investing exactly that amount lands on the target.
    const check = projectGoal({ ...plan, monthly: requiredMonthly });
    expect(check.projected).toBeCloseTo(1_000_000, 4);

    expect(projectGoal({ ...plan, current: 2_000_000 }).requiredMonthly).toBe(0);
  });
});

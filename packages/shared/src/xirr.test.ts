import { describe, expect, it } from 'vitest';
import { xirr } from './xirr.js';

describe('xirr', () => {
  it('matches the worked example in Microsoft Excel’s XIRR documentation', () => {
    const rate = xirr([
      { date: '2008-01-01', amount: '-10000' },
      { date: '2008-03-01', amount: '2750' },
      { date: '2008-10-30', amount: '4250' },
      { date: '2009-02-15', amount: '3250' },
      { date: '2009-04-01', amount: '2750' },
    ]);

    expect(rate).not.toBeNull();
    expect(rate).toBeCloseTo(0.373362535, 6);
  });

  it('is exactly 10% for 10% growth over one 365-day year', () => {
    const rate = xirr([
      { date: '2023-01-01', amount: '-1000' },
      { date: '2024-01-01', amount: '1100' },
    ]);

    expect(rate).toBeCloseTo(0.1, 9);
  });

  it('handles losses', () => {
    const rate = xirr([
      { date: '2023-01-01', amount: '-1000' },
      { date: '2024-01-01', amount: '800' },
    ]);

    expect(rate).toBeCloseTo(-0.2, 9);
  });

  it('weights SIP instalments by how long each was invested', () => {
    // Twelve monthly ₹1,000 SIPs worth ₹13,000 a month after the last one.
    const flows = Array.from({ length: 12 }, (_, i) => ({
      date: `2024-${String(i + 1).padStart(2, '0')}-05`,
      amount: '-1000',
    }));
    flows.push({ date: '2025-01-05', amount: '13000' });

    const rate = xirr(flows);

    // A simple 8.3% gain, but the average rupee was invested only ~6.5 months: XIRR is far higher.
    expect(rate).not.toBeNull();
    expect(rate as number).toBeGreaterThan(0.14);
    expect(rate as number).toBeLessThan(0.17);
  });

  it('returns null when no rate can exist', () => {
    expect(xirr([{ date: '2024-01-01', amount: '-1000' }])).toBeNull();
    expect(
      xirr([
        { date: '2024-01-01', amount: '1000' },
        { date: '2024-06-01', amount: '1000' },
      ]),
    ).toBeNull();
    expect(xirr([])).toBeNull();
  });
});

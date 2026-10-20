import { describe, expect, it } from 'vitest';
import { computeDrift } from './drift.js';

describe('computeDrift', () => {
  const sixtyForty = [
    { key: 'NIFTYBEES.NS', weight: '0.6' },
    { key: 'LIQUIDBEES.NS', weight: '0.4' },
  ];

  it('reports no rebalance when the portfolio matches its targets', () => {
    const report = computeDrift(
      [
        { key: 'NIFTYBEES.NS', marketValue: '60000' },
        { key: 'LIQUIDBEES.NS', marketValue: '40000' },
      ],
      sixtyForty,
      '0.05',
    );

    expect(report.totalValue.toString()).toBe('100000');
    expect(report.needsRebalance).toBe(false);
    expect(report.maxAbsDrift.toString()).toBe('0');
  });

  it('flags positions that drift beyond the threshold', () => {
    const report = computeDrift(
      [
        { key: 'NIFTYBEES.NS', marketValue: '70000' },
        { key: 'LIQUIDBEES.NS', marketValue: '30000' },
      ],
      sixtyForty,
      '0.05',
    );

    const equity = report.rows.find((row) => row.key === 'NIFTYBEES.NS');
    expect(equity?.drift.toString()).toBe('0.1');
    expect(equity?.breached).toBe(true);
    expect(report.needsRebalance).toBe(true);
  });

  it('sums positions that share a key, e.g. the same stock held at two brokers', () => {
    const report = computeDrift(
      [
        { key: 'NIFTYBEES.NS', marketValue: '30000' },
        { key: 'NIFTYBEES.NS', marketValue: '30000' },
        { key: 'LIQUIDBEES.NS', marketValue: '40000' },
      ],
      sixtyForty,
      '0.05',
    );

    expect(report.rows.find((row) => row.key === 'NIFTYBEES.NS')?.currentWeight.toString()).toBe('0.6');
  });

  it('treats holdings missing from the targets as a 0% target', () => {
    const report = computeDrift(
      [
        { key: 'NIFTYBEES.NS', marketValue: '50000' },
        { key: 'LIQUIDBEES.NS', marketValue: '40000' },
        { key: 'IRCTC.NS', marketValue: '10000' },
      ],
      sixtyForty,
      '0.05',
    );

    const offModel = report.rows.find((row) => row.key === 'IRCTC.NS');
    expect(offModel?.targetWeight.toString()).toBe('0');
    expect(offModel?.breached).toBe(true);
  });

  it('does exact decimal arithmetic where floats would not', () => {
    const report = computeDrift(
      [
        { key: 'A', marketValue: '0.1' },
        { key: 'B', marketValue: '0.2' },
      ],
      [
        { key: 'A', weight: '0.5' },
        { key: 'B', weight: '0.5' },
      ],
      '0.5',
    );

    expect(0.1 + 0.2).not.toBe(0.3);
    expect(report.totalValue.toString()).toBe('0.3');
  });

  it('handles an empty portfolio without dividing by zero', () => {
    const report = computeDrift([], sixtyForty, '0.05');

    expect(report.totalValue.toString()).toBe('0');
    expect(report.rows.every((row) => row.currentWeight.isZero())).toBe(true);
  });

  it('rejects targets that do not sum to 1', () => {
    expect(() => computeDrift([], [{ key: 'A', weight: '0.7' }], '0.05')).toThrow(/sum to 1/);
  });

  it('rejects duplicate targets', () => {
    expect(() =>
      computeDrift(
        [],
        [
          { key: 'A', weight: '0.5' },
          { key: 'A', weight: '0.5' },
        ],
        '0.05',
      ),
    ).toThrow(/Duplicate/);
  });
});

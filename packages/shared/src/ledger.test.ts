import { describe, expect, it } from 'vitest';
import { cashFlowOf, type LedgerEntry, LedgerError, replay } from './ledger.js';

const buy = (id: string, date: string, quantity: string, price: string, fees = '0'): LedgerEntry => ({
  id,
  instrumentKey: 'TCS.NS',
  type: 'buy',
  tradeDate: date,
  quantity,
  price,
  fees,
});
const sell = (id: string, date: string, quantity: string, price: string, fees = '0'): LedgerEntry => ({
  id,
  instrumentKey: 'TCS.NS',
  type: 'sell',
  tradeDate: date,
  quantity,
  price,
  fees,
});

describe('replay', () => {
  it('builds a position whose cost includes fees', () => {
    const { positions } = replay([
      buy('a', '2024-01-10', '10', '3000', '20'),
      buy('b', '2024-06-10', '5', '3600', '10'),
    ]);
    const tcs = positions.get('TCS.NS');

    expect(tcs?.quantity.toString()).toBe('15');
    expect(tcs?.costBasis.toString()).toBe('48030'); // 30020 + 18010
    expect(tcs?.lots).toHaveLength(2);
  });

  it('sells oldest lots first and records each slice for tax', () => {
    const { positions, sales } = replay([
      buy('a', '2023-01-10', '10', '3000'),
      buy('b', '2024-06-10', '10', '3600'),
      sell('c', '2024-09-01', '15', '4000', '50'),
    ]);

    const sale = sales[0];
    expect(sale?.cost.toString()).toBe('48000'); // all of lot a (30000) + half of lot b (18000)
    expect(sale?.proceeds.toString()).toBe('59950'); // 60000 - 50 fees
    expect(sale?.gain.toString()).toBe('11950');
    expect(sale?.slices.map((s) => [s.acquiredOn, s.quantity.toString()])).toEqual([
      ['2023-01-10', '10'],
      ['2024-06-10', '5'],
    ]);

    const tcs = positions.get('TCS.NS');
    expect(tcs?.quantity.toString()).toBe('5');
    expect(tcs?.costBasis.toString()).toBe('18000');
    expect(tcs?.realizedGain.toString()).toBe('11950');
  });

  it('refuses to sell more than was held on that date', () => {
    expect.assertions(3);
    expect(() => replay([buy('a', '2024-01-10', '5', '100'), sell('b', '2024-01-05', '5', '120')])).toThrow(
      LedgerError,
    );
    try {
      replay([buy('a', '2024-01-10', '5', '100'), sell('b', '2024-02-01', '6', '120')]);
    } catch (error) {
      expect((error as LedgerError).entryId).toBe('b');
      expect((error as LedgerError).message).toMatch(/only 5 held/);
    }
  });

  it('replays in date order regardless of input order, keeping input order for same-day entries', () => {
    const { positions } = replay([
      sell('s', '2024-03-01', '2', '150'),
      buy('a', '2024-01-01', '5', '100'),
      buy('same-day-buy', '2024-03-01', '1', '150'),
    ]);

    expect(positions.get('TCS.NS')?.quantity.toString()).toBe('4');
  });

  it('closes a position completely', () => {
    const { positions } = replay([buy('a', '2024-01-01', '5', '100'), sell('b', '2024-02-01', '5', '110')]);
    const tcs = positions.get('TCS.NS');

    expect(tcs?.quantity.isZero()).toBe(true);
    expect(tcs?.costBasis.isZero()).toBe(true);
    expect(tcs?.lots).toEqual([]);
  });

  it('accumulates dividends without touching quantity or cost', () => {
    const { positions } = replay([
      buy('a', '2024-01-01', '10', '100'),
      { id: 'd', instrumentKey: 'TCS.NS', type: 'dividend', tradeDate: '2024-06-01', amount: '73.5' },
    ]);
    const tcs = positions.get('TCS.NS');

    expect(tcs?.dividends.toString()).toBe('73.5');
    expect(tcs?.costBasis.toString()).toBe('1000');
  });

  it('keeps fractional mutual fund units exact', () => {
    const { positions } = replay([
      { ...buy('a', '2024-01-05', '33.333', '0.1'), instrumentKey: 'MF-122639' },
      { ...buy('b', '2024-02-05', '33.334', '0.2'), instrumentKey: 'MF-122639' },
    ]);
    const fund = positions.get('MF-122639');

    expect(fund?.quantity.toString()).toBe('66.667');
    expect(fund?.costBasis.toString()).toBe('10.0001'); // 3.3333 + 6.6668, no float drift
  });

  it('rejects missing or non-positive amounts', () => {
    expect(() => replay([{ id: 'x', instrumentKey: 'A', type: 'buy', tradeDate: '2024-01-01', price: '10' }])).toThrow(
      /needs a quantity/,
    );
    expect(() => replay([buy('x', '2024-01-01', '-1', '10')])).toThrow(/greater than zero/);
  });
});

describe('cashFlowOf', () => {
  it('signs money in as negative and money out as positive', () => {
    expect(cashFlowOf(buy('a', '2024-01-01', '10', '100', '5')).toString()).toBe('-1005');
    expect(cashFlowOf(sell('b', '2024-02-01', '10', '120', '5')).toString()).toBe('1195');
    expect(
      cashFlowOf({ id: 'd', instrumentKey: 'A', type: 'dividend', tradeDate: '2024-03-01', amount: '40' }).toString(),
    ).toBe('40');
  });
});

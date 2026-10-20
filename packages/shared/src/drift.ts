import { Decimal } from './money.js';

export interface PositionValue {
  key: string;
  marketValue: Decimal.Value;
}

export interface TargetWeight {
  key: string;
  /** Fraction of the portfolio, 0..1. */
  weight: Decimal.Value;
}

export interface DriftRow {
  key: string;
  currentWeight: Decimal;
  targetWeight: Decimal;
  /** currentWeight - targetWeight. Positive means overweight. */
  drift: Decimal;
  breached: boolean;
}

export interface DriftReport {
  totalValue: Decimal;
  rows: DriftRow[];
  maxAbsDrift: Decimal;
  needsRebalance: boolean;
}

const WEIGHT_SUM_TOLERANCE = new Decimal('0.000001');

/**
 * Compares what a portfolio holds against its target allocation.
 *
 * `key` is whatever the allocation is defined over: a symbol ("VTI") or an
 * asset class ("equity"). Positions sharing a key are summed, and anything held
 * but absent from the targets is treated as a 0% target, so it always shows up.
 */
export function computeDrift(
  positions: readonly PositionValue[],
  targets: readonly TargetWeight[],
  threshold: Decimal.Value,
): DriftReport {
  const limit = new Decimal(threshold);

  const valueByKey = new Map<string, Decimal>();
  for (const position of positions) {
    const previous = valueByKey.get(position.key) ?? new Decimal(0);
    valueByKey.set(position.key, previous.plus(position.marketValue));
  }

  const targetByKey = new Map<string, Decimal>();
  for (const target of targets) {
    const weight = new Decimal(target.weight);
    if (weight.isNegative() || weight.greaterThan(1)) {
      throw new RangeError(`Target weight for ${target.key} must be between 0 and 1`);
    }
    if (targetByKey.has(target.key)) {
      throw new RangeError(`Duplicate target for ${target.key}`);
    }
    targetByKey.set(target.key, weight);
  }

  const targetSum = Decimal.sum(new Decimal(0), ...targetByKey.values());
  if (targetSum.minus(1).abs().greaterThan(WEIGHT_SUM_TOLERANCE)) {
    throw new RangeError(`Target weights must sum to 1, got ${targetSum.toString()}`);
  }

  const totalValue = Decimal.sum(new Decimal(0), ...valueByKey.values());
  const keys = [...new Set([...valueByKey.keys(), ...targetByKey.keys()])].sort();

  const rows = keys.map((key): DriftRow => {
    const value = valueByKey.get(key) ?? new Decimal(0);
    const currentWeight = totalValue.isZero() ? new Decimal(0) : value.dividedBy(totalValue);
    const targetWeight = targetByKey.get(key) ?? new Decimal(0);
    const drift = currentWeight.minus(targetWeight);
    return { key, currentWeight, targetWeight, drift, breached: drift.abs().greaterThan(limit) };
  });

  const maxAbsDrift = Decimal.max(new Decimal(0), ...rows.map((row) => row.drift.abs()));

  return { totalValue, rows, maxAbsDrift, needsRebalance: rows.some((row) => row.breached) };
}

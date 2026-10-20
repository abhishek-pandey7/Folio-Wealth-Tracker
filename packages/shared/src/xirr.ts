import { Decimal } from './money.js';

export interface CashFlow {
  /** YYYY-MM-DD. */
  date: string;
  /** Negative when money goes in (a buy), positive when it comes out (a sale, a dividend, today's value). */
  amount: Decimal.Value;
}

const DAY_MS = 86_400_000;

/**
 * XIRR: the annual rate r at which the dated cash flows net to zero,
 * sum(amount / (1 + r)^(years since the first flow)) = 0.
 *
 * It is the right return for irregular investing (SIPs, top-ups, partial
 * sales), where "total gain / total invested" ignores how long each rupee was
 * invested. The result is a rate estimate, so it is solved in floating point;
 * the amounts themselves come in as exact decimals.
 *
 * Returns null when the flows cannot have a rate (no money in, or none out)
 * or the solver does not converge.
 */
export function xirr(flows: readonly CashFlow[]): number | null {
  const points = flows
    .map((f) => ({ t: Date.parse(`${f.date}T00:00:00Z`), amount: new Decimal(f.amount).toNumber() }))
    .filter((p) => Number.isFinite(p.t) && p.amount !== 0);
  if (!points.some((p) => p.amount < 0) || !points.some((p) => p.amount > 0)) {
    return null;
  }

  const start = Math.min(...points.map((p) => p.t));
  const years = points.map((p) => ({ y: (p.t - start) / DAY_MS / 365, amount: p.amount }));
  const npv = (r: number) => years.reduce((sum, p) => sum + p.amount / (1 + r) ** p.y, 0);
  const dnpv = (r: number) => years.reduce((sum, p) => sum - (p.y * p.amount) / (1 + r) ** (p.y + 1), 0);

  // Newton's method converges fast from a sensible guess...
  let rate = 0.1;
  for (let i = 0; i < 50; i++) {
    const value = npv(rate);
    if (Math.abs(value) < 1e-7) {
      return rate;
    }
    const slope = dnpv(rate);
    if (slope === 0 || !Number.isFinite(slope)) {
      break;
    }
    const next = rate - value / slope;
    if (!Number.isFinite(next) || next <= -0.9999) {
      break;
    }
    if (Math.abs(next - rate) < 1e-10) {
      return next;
    }
    rate = next;
  }

  // ...and bisection is the safety net when it overshoots on unusual flows.
  let low = -0.9999;
  let high = 100;
  let fLow = npv(low);
  if (fLow * npv(high) > 0) {
    return null;
  }
  for (let i = 0; i < 300; i++) {
    const mid = (low + high) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-7 || high - low < 1e-12) {
      return mid;
    }
    if (fLow * fMid < 0) {
      high = mid;
    } else {
      low = mid;
      fLow = fMid;
    }
  }
  return null;
}

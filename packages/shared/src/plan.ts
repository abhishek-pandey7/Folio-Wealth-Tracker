import { Decimal } from './money.js';

/**
 * SIP schedules and goal projections. Schedules and units are exact; goal
 * projections are estimates under an assumed return the user chooses, so
 * they use floating point and are shown rounded, never as predictions.
 */

// Day 29 to 31 do not exist in every month, so SIP dates are 1 to 28, as most fund houses allow.
export const MAX_SIP_DAY = 28;

function parseDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Every instalment date from `from` (inclusive) to `until` (inclusive) for a SIP on `dayOfMonth`. */
export function sipDueDates(from: string, dayOfMonth: number, until: string): string[] {
  if (dayOfMonth < 1 || dayOfMonth > MAX_SIP_DAY) {
    throw new RangeError(`SIP day must be between 1 and ${MAX_SIP_DAY}`);
  }
  const start = parseDate(from);
  const end = parseDate(until);
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth();
  if (start.getUTCDate() > dayOfMonth) {
    month += 1;
  }

  const dates: string[] = [];
  for (;;) {
    const due = new Date(Date.UTC(year, month, dayOfMonth));
    if (due > end) break;
    dates.push(isoDate(due));
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return dates;
}

/** The next instalment on or after `today`. */
export function nextSipDate(activeFrom: string, dayOfMonth: number, today: string): string {
  const from = activeFrom > today ? activeFrom : today;
  const [next] = sipDueDates(from, dayOfMonth, isoDate(new Date(parseDate(from).getTime() + 62 * 86_400_000)));
  if (!next) {
    throw new Error('unreachable: a monthly schedule always has a date within two months');
  }
  return next;
}

export interface SipPurchase {
  /** Units allotted: rounded down to 3 decimals, as fund houses allot. */
  units: Decimal;
  /** NAV at the 4 decimals the ledger stores. */
  price: Decimal;
  /** What units x price leaves of the amount (rounding, stamp duty). Keeps cost = amount exactly. */
  residual: Decimal;
}

export function sipPurchase(amount: Decimal.Value, nav: Decimal.Value): SipPurchase {
  const total = new Decimal(amount);
  const price = new Decimal(nav).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  if (!price.isPositive() || price.isZero()) {
    throw new RangeError('NAV must be positive');
  }
  const units = total.dividedBy(price).toDecimalPlaces(3, Decimal.ROUND_DOWN);
  return { units, price, residual: total.minus(units.times(price)) };
}

/** Converts an annual rate to the equivalent compounded monthly rate. */
export function monthlyRate(annual: number): number {
  return (1 + annual) ** (1 / 12) - 1;
}

/** Whole months from `from` to `to`, counting a partial month only once its day is reached. */
export function monthsBetween(from: string, to: string): number {
  const a = parseDate(from);
  const b = parseDate(to);
  const months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  return Math.max(0, b.getUTCDate() >= a.getUTCDate() ? months : months - 1);
}

export interface GoalProjection {
  /** Value at the target date if current savings and SIPs continue at the assumed return. */
  projected: number;
  /** Monthly investment needed from now on to reach the target (0 when already on track). */
  requiredMonthly: number;
}

/**
 * Future value of today's savings plus a monthly contribution (made at the end
 * of each month), compounded at the assumed annual return.
 */
export function projectGoal(input: {
  current: number;
  monthly: number;
  annualReturn: number;
  months: number;
  target: number;
}): GoalProjection {
  const { current, monthly, annualReturn, months, target } = input;
  const r = monthlyRate(annualReturn);
  const growth = (1 + r) ** months;
  // Future value of 1 per month for `months` months; the r = 0 case is a plain sum.
  const annuity = r === 0 ? months : (growth - 1) / r;
  const projected = current * growth + monthly * annuity;
  const gap = target - current * growth;
  const requiredMonthly = months === 0 ? Math.max(0, gap) : Math.max(0, gap / annuity);
  return { projected, requiredMonthly };
}

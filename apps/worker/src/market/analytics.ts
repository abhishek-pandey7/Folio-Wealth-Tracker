// Performance and risk statistics from a price or NAV series. A line-for-line
// port of the Go gateway's analytics package, so both deployments rank alike.
// Statistics are floats on purpose: returns and volatility are ratios and
// estimates, not money.

import { type Metrics, PERIODS, type Period } from '@folio/shared';

/** `date` is UTC midnight in epoch milliseconds. Series are sorted oldest first. */
export interface Point {
  date: number;
  value: number;
}

const DAY_MS = 86_400_000;

export const toDate = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
export const isoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Calendar arithmetic with Go's AddDate overflow rules (Mar 31 minus a month is Mar 3). */
function addDate(ms: number, years: number, months: number, days: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear() + years, d.getUTCMonth() + months, d.getUTCDate() + days);
}

const annualized = (p: Period) => p === '3y' || p === '5y';

function periodStart(p: Period, ref: number): number {
  switch (p) {
    case '1w':
      return addDate(ref, 0, 0, -7);
    case '1m':
      return addDate(ref, 0, -1, 0);
    case '3m':
      return addDate(ref, 0, -3, 0);
    case '6m':
      return addDate(ref, 0, -6, 0);
    case 'ytd':
      // The base is the last close of the previous year.
      return Date.UTC(new Date(ref).getUTCFullYear(), 0, 1) - 1;
    case '1y':
      return addDate(ref, -1, 0, 0);
    case '3y':
      return addDate(ref, -3, 0, 0);
    case '5y':
      return addDate(ref, -5, 0, 0);
    default:
      return ref;
  }
}

/** How far after a period's start the first point may fall and still be its base (holidays, range edges). */
const BASE_TOLERANCE_MS = 7 * DAY_MS;

/** The last index whose date is <= t, or -1. */
function indexAtOrBefore(points: Point[], t: number): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((points[mid] as Point).date > t) hi = mid;
    else lo = mid + 1;
  }
  return lo - 1;
}

/** Percentage change over p, ending at the last point; null when the series does not reach back far enough. */
export function periodReturn(points: Point[], p: Period): number | null {
  const n = points.length;
  if (n < 2) return null;
  const last = points[n - 1] as Point;

  let base: Point;
  if (p === '1d') {
    base = points[n - 2] as Point;
  } else {
    const start = periodStart(p, last.date);
    const i = indexAtOrBefore(points, start);
    if (i >= 0) base = points[i] as Point;
    // Providers' "5y" ranges often begin a few days after the exact mark.
    // CAGR below uses the real base date, so this stays accurate.
    else if ((points[0] as Point).date - start <= BASE_TOLERANCE_MS) base = points[0] as Point;
    else return null;
  }
  if (base.value <= 0 || base.date >= last.date) return null;

  const growth = last.value / base.value;
  if (annualized(p)) {
    const years = (last.date - base.date) / DAY_MS / 365.25;
    return (growth ** (1 / years) - 1) * 100;
  }
  return (growth - 1) * 100;
}

/**
 * The last year of points, including the base at or before the year mark, or
 * null when the series does not cover a full year: a fund launched four months
 * ago must not be ranked "steadiest" against funds measured over twelve.
 */
function lastYear(points: Point[]): Point[] | null {
  if (points.length === 0) return null;
  const yearAgo = addDate((points[points.length - 1] as Point).date, -1, 0, 0);
  if ((points[0] as Point).date - yearAgo > BASE_TOLERANCE_MS) return null;
  return points.slice(Math.max(indexAtOrBefore(points, yearAgo), 0));
}

/** Indian and US markets both trade about 250 days a year, and so do daily NAV publications. */
const TRADING_DAYS_PER_YEAR = 252;

/** Below this, volatility and drawdown would be noise. */
const MIN_POINTS_FOR_STATS = 40;

/** Annualized standard deviation of daily log returns over the last year, in percent. */
export function volatility(points: Point[]): number | null {
  const w = lastYear(points);
  if (!w || w.length < MIN_POINTS_FOR_STATS) return null;
  const returns: number[] = [];
  for (let i = 1; i < w.length; i++) {
    const prev = (w[i - 1] as Point).value;
    const cur = (w[i] as Point).value;
    if (prev > 0 && cur > 0) returns.push(Math.log(cur / prev));
  }
  if (returns.length < 2) return null;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100;
}

/** Worst peak-to-trough fall over the last year, in percent (zero or negative). */
export function maxDrawdown(points: Point[]): number | null {
  const w = lastYear(points);
  if (!w || w.length < MIN_POINTS_FOR_STATS) return null;
  let peak = (w[0] as Point).value;
  let worst = 0;
  for (const p of w) {
    peak = Math.max(peak, p.value);
    if (peak > 0) worst = Math.min(worst, p.value / peak - 1);
  }
  return worst * 100;
}

/** How many of the last n calendar months closed higher than the month before; the current month counts. */
export function upMonths(points: Point[], n: number): { up: number; total: number } {
  const ends: Point[] = [];
  const monthOf = (ms: number) => {
    const d = new Date(ms);
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
  };
  for (const p of points) {
    const k = ends.length;
    if (k > 0 && monthOf((ends[k - 1] as Point).date) === monthOf(p.date)) ends[k - 1] = p;
    else ends.push(p);
  }
  let up = 0;
  let total = 0;
  for (let i = Math.max(1, ends.length - n); i < ends.length; i++) {
    total++;
    if ((ends[i] as Point).value > (ends[i - 1] as Point).value) up++;
  }
  return { up, total };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function computeMetrics(points: Point[]): Metrics {
  const returns = {} as Record<Period, number | null>;
  for (const p of PERIODS) {
    const r = periodReturn(points, p);
    returns[p] = r === null ? null : round2(r);
  }
  const vol = volatility(points);
  const dd = maxDrawdown(points);
  const r1y = returns['1y'];
  const { up, total } = upMonths(points, 12);
  return {
    asOf: points.length ? isoDate((points[points.length - 1] as Point).date) : '',
    returns,
    volatility1y: vol === null ? null : round2(vol),
    maxDrawdown1y: dd === null ? null : round2(dd),
    riskAdjusted1y: r1y !== null && vol !== null && vol > 0 ? round2(r1y / vol) : null,
    upMonths: up,
    months: total,
  };
}

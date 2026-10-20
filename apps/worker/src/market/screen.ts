// Screen parameters and ranking, ported from the Go gateway's screener.

import { BadRequestError } from '@folio/core';
import { type Metrics, type Period, PeriodSchema, type SortKey, SortKeySchema } from '@folio/shared';

export interface ScreenParams {
  period?: string;
  sort?: string;
  order?: string;
  limit?: string;
}

export interface Screen {
  period: Period;
  sort: SortKey;
  order: 'best' | 'worst';
  limit: number;
}

/** At most this many symbols or funds in an explicit list. */
export const MAX_LIST = 50;

export function parseScreen(q: ScreenParams, defaultPeriod: Period): Screen {
  const period = q.period ? PeriodSchema.safeParse(q.period) : { success: true as const, data: defaultPeriod };
  if (!period.success) throw new BadRequestError('period must be one of 1d, 1w, 1m, 3m, 6m, ytd, 1y, 3y, 5y');
  const sort = SortKeySchema.safeParse(q.sort || 'return');
  if (!sort.success) {
    throw new BadRequestError('sort must be one of return, risk_adjusted, volatility, drawdown, consistency');
  }
  const order = q.order || 'best';
  if (order !== 'best' && order !== 'worst') throw new BadRequestError('order must be best or worst');
  const limit = q.limit ? Number(q.limit) : 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new BadRequestError('limit must be between 1 and 100');
  return { period: period.data, sort: sort.data, order, limit };
}

/** The ranked number; null sorts last in either order. */
function sortValue(m: Metrics, key: SortKey, period: Period): number | null {
  switch (key) {
    case 'return':
      return m.returns[period] ?? null;
    case 'risk_adjusted':
      return m.riskAdjusted1y;
    case 'volatility':
      return m.volatility1y;
    case 'drawdown':
      return m.maxDrawdown1y;
    case 'consistency':
      return m.months === 0 ? null : (m.upMonths / m.months) * 100;
  }
}

const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Sorts best first. Higher is better for every key except volatility, and
 * drawdowns are negative, so closer to zero is better there too.
 */
export function rank<T extends { metrics: Metrics }>(rows: T[], id: (row: T) => string, s: Screen): T[] {
  let bestHigh = s.sort !== 'volatility';
  if (s.order === 'worst') bestHigh = !bestHigh;
  return rows.sort((a, b) => {
    const va = sortValue(a.metrics, s.sort, s.period);
    const vb = sortValue(b.metrics, s.sort, s.period);
    if (va === null && vb === null) return compareIds(id(a), id(b));
    if (va === null) return 1;
    if (vb === null) return -1;
    const c = bestHigh ? vb - va : va - vb;
    return c === 0 ? compareIds(id(a), id(b)) : c;
  });
}

/** Splits a comma list, trimming and dropping empties. */
export const splitList = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

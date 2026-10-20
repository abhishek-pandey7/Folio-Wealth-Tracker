import { ANNUALIZED_PERIODS, type Currency, formatMoney, type Period } from '@folio/shared';

export const PERIOD_LABELS: Record<Period, string> = {
  '1d': '1D',
  '1w': '1W',
  '1m': '1M',
  '3m': '3M',
  '6m': '6M',
  ytd: 'YTD',
  '1y': '1Y',
  '3y': '3Y',
  '5y': '5Y',
};

/** Column heading for a period's return; multi-year returns are per-year rates. */
export function returnHeading(period: Period): string {
  return ANNUALIZED_PERIODS.includes(period) ? `${PERIOD_LABELS[period]} p.a.` : `${PERIOD_LABELS[period]} return`;
}

export function pct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) {
    return 'n/a';
  }
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

/** Unsigned percentage, for quantities that are never "gains" (volatility). */
export function plainPct(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined ? 'n/a' : `${value.toFixed(digits)}%`;
}

export function ratio(value: number | null | undefined): string {
  return value === null || value === undefined ? 'n/a' : value.toFixed(2);
}

export function tone(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'muted';
  return value > 0 ? 'up' : value < 0 ? 'down' : '';
}

const indexFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/** Indices are points, not money; everything else is priced in its currency. */
export function price(value: string, currency: Currency, isIndex = false): string {
  return isIndex ? indexFormat.format(Number(value)) : formatMoney(value, currency);
}

export function isIndexSymbol(symbol: string): boolean {
  return symbol.startsWith('^');
}

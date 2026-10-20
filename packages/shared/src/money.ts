import { Decimal } from 'decimal.js';

export { Decimal };

/**
 * Money, quantities and weights cross every boundary (DB, HTTP, UI) as decimal
 * strings and are computed with Decimal. JS floats never touch them:
 * 0.1 + 0.2 !== 0.3 is not acceptable in a ledger.
 */
export const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

export const CURRENCIES = ['INR', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

const LOCALE_BY_CURRENCY: Record<Currency, string> = {
  INR: 'en-IN',
  USD: 'en-US',
};

const formatters = new Map<Currency, Intl.NumberFormat>();

/** Display-only formatting; the float conversion here never feeds back into math. */
export function formatMoney(value: Decimal.Value, currency: Currency): string {
  let formatter = formatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat(LOCALE_BY_CURRENCY[currency], { style: 'currency', currency });
    formatters.set(currency, formatter);
  }
  return formatter.format(new Decimal(value).toNumber());
}

export function formatPercent(value: Decimal.Value, fractionDigits = 2): string {
  return `${new Decimal(value).toFixed(fractionDigits)}%`;
}

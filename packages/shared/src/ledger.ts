import { Decimal } from './money.js';

/**
 * The ledger is the source of truth: holdings, cost basis and realized gains
 * are never stored, only derived by replaying transactions in date order. A
 * correction is an edited or deleted entry, and every number recomputes.
 */

export const LEDGER_TYPES = ['buy', 'sell', 'dividend'] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

export interface LedgerEntry {
  id: string;
  /** Instrument identity: a ticker such as TCS.NS, or MF-<scheme code> for funds. */
  instrumentKey: string;
  type: LedgerType;
  /** YYYY-MM-DD. */
  tradeDate: string;
  /** Units; required for buy and sell. */
  quantity?: Decimal.Value | null;
  /** Price per unit; required for buy and sell. */
  price?: Decimal.Value | null;
  /** Brokerage, STT, stamp duty and other charges. */
  fees?: Decimal.Value | null;
  /** Cash received; required for dividends. */
  amount?: Decimal.Value | null;
}

/** Shares bought together, at one cost. Sales consume lots oldest first (FIFO). */
export interface Lot {
  entryId: string;
  acquiredOn: string;
  quantity: Decimal;
  /** Cost per unit including the purchase's fees. */
  unitCost: Decimal;
}

/** The part of one lot that one sale consumed: what capital gains tax is computed on. */
export interface SaleSlice {
  acquiredOn: string;
  quantity: Decimal;
  cost: Decimal;
}

export interface Sale {
  entryId: string;
  instrumentKey: string;
  soldOn: string;
  quantity: Decimal;
  /** Sale value net of fees. */
  proceeds: Decimal;
  cost: Decimal;
  gain: Decimal;
  slices: SaleSlice[];
}

export interface Position {
  instrumentKey: string;
  quantity: Decimal;
  /** Total cost of the units still held. */
  costBasis: Decimal;
  lots: Lot[];
  realizedGain: Decimal;
  dividends: Decimal;
}

export class LedgerError extends Error {
  constructor(
    message: string,
    readonly entryId: string,
  ) {
    super(message);
  }
}

export interface Replay {
  positions: Map<string, Position>;
  sales: Sale[];
}

function emptyPosition(instrumentKey: string): Position {
  return {
    instrumentKey,
    quantity: new Decimal(0),
    costBasis: new Decimal(0),
    lots: [],
    realizedGain: new Decimal(0),
    dividends: new Decimal(0),
  };
}

function required(entry: LedgerEntry, field: 'quantity' | 'price' | 'amount'): Decimal {
  const raw = entry[field];
  if (raw === undefined || raw === null || raw === '') {
    throw new LedgerError(`A ${entry.type} needs a ${field}`, entry.id);
  }
  const value = new Decimal(raw);
  if (!value.isPositive() || value.isZero()) {
    throw new LedgerError(`${field} must be greater than zero`, entry.id);
  }
  return value;
}

/**
 * Replays entries in trade-date order (ties keep input order, so pass entries
 * oldest-created first). Throws LedgerError for an impossible history, such
 * as selling more units than were held on that date.
 */
export function replay(entries: readonly LedgerEntry[]): Replay {
  const ordered = entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.tradeDate.localeCompare(b.entry.tradeDate) || a.index - b.index)
    .map(({ entry }) => entry);

  const positions = new Map<string, Position>();
  const sales: Sale[] = [];

  for (const entry of ordered) {
    const position = positions.get(entry.instrumentKey) ?? emptyPosition(entry.instrumentKey);
    positions.set(entry.instrumentKey, position);
    const fees = new Decimal(entry.fees ?? 0);
    if (fees.isNegative()) {
      throw new LedgerError('fees cannot be negative', entry.id);
    }

    switch (entry.type) {
      case 'buy': {
        const quantity = required(entry, 'quantity');
        const cost = quantity.times(required(entry, 'price')).plus(fees);
        position.lots.push({
          entryId: entry.id,
          acquiredOn: entry.tradeDate,
          quantity,
          unitCost: cost.dividedBy(quantity),
        });
        position.quantity = position.quantity.plus(quantity);
        position.costBasis = position.costBasis.plus(cost);
        break;
      }

      case 'sell': {
        const quantity = required(entry, 'quantity');
        if (quantity.greaterThan(position.quantity)) {
          throw new LedgerError(
            `Cannot sell ${quantity.toString()} units of ${entry.instrumentKey} on ${entry.tradeDate}; only ${position.quantity.toString()} held`,
            entry.id,
          );
        }
        const proceeds = quantity.times(required(entry, 'price')).minus(fees);

        let remaining = quantity;
        let cost = new Decimal(0);
        const slices: SaleSlice[] = [];
        while (remaining.greaterThan(0)) {
          const lot = position.lots[0];
          if (!lot) {
            throw new LedgerError('Lots out of sync with quantity', entry.id); // unreachable if the check above holds
          }
          const taken = Decimal.min(lot.quantity, remaining);
          const sliceCost = taken.times(lot.unitCost);
          slices.push({ acquiredOn: lot.acquiredOn, quantity: taken, cost: sliceCost });
          cost = cost.plus(sliceCost);
          remaining = remaining.minus(taken);
          lot.quantity = lot.quantity.minus(taken);
          if (lot.quantity.isZero()) {
            position.lots.shift();
          }
        }

        const gain = proceeds.minus(cost);
        position.quantity = position.quantity.minus(quantity);
        position.costBasis = position.costBasis.minus(cost);
        position.realizedGain = position.realizedGain.plus(gain);
        sales.push({
          entryId: entry.id,
          instrumentKey: entry.instrumentKey,
          soldOn: entry.tradeDate,
          quantity,
          proceeds,
          cost,
          gain,
          slices,
        });
        break;
      }

      case 'dividend': {
        position.dividends = position.dividends.plus(required(entry, 'amount').minus(fees));
        break;
      }
    }
  }

  return { positions, sales };
}

/** The signed cash effect of an entry: money leaving your pocket is negative. */
export function cashFlowOf(entry: LedgerEntry): Decimal {
  const fees = new Decimal(entry.fees ?? 0);
  switch (entry.type) {
    case 'buy':
      return new Decimal(entry.quantity ?? 0)
        .times(entry.price ?? 0)
        .plus(fees)
        .negated();
    case 'sell':
      return new Decimal(entry.quantity ?? 0).times(entry.price ?? 0).minus(fees);
    case 'dividend':
      return new Decimal(entry.amount ?? 0).minus(fees);
  }
}

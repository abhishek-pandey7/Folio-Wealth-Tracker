import {
  type CreateTransaction,
  cashFlowOf,
  Decimal,
  type LedgerEntry,
  LedgerError,
  replay,
  type Transaction,
} from '@folio/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { AccountsService } from './accounts.js';
import type { Database } from './database.js';
import { BadRequestError, NotFoundError, UnprocessableError } from './errors.js';
import { type InstrumentsService, schemeCodeOf } from './instruments.js';
import { instruments, portfolios, transactions } from './schema.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type DbOrTx = Database | Tx;

const SUPPORTED_TYPES = new Set(['buy', 'sell', 'dividend']);

/** Postgres NUMERIC comes back padded ("10.000000"); show the plain value. */
function clean(value: string | null): string | null {
  return value === null ? null : new Decimal(value).toString();
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export class TransactionsService {
  constructor(
    private readonly db: Database,
    private readonly accounts: AccountsService,
    private readonly instruments: InstrumentsService,
  ) {}

  async list(userId: string, accountId?: string): Promise<Transaction[]> {
    const rows = await this.db
      .select({ t: transactions, accountName: portfolios.name, instrument: instruments })
      .from(transactions)
      .innerJoin(portfolios, eq(transactions.portfolioId, portfolios.id))
      .innerJoin(instruments, eq(transactions.instrumentId, instruments.id))
      .where(and(eq(portfolios.userId, userId), accountId ? eq(portfolios.id, accountId) : undefined))
      .orderBy(desc(transactions.tradeDate), desc(transactions.createdAt));

    return rows.flatMap(({ t, accountName, instrument }) => {
      if (!SUPPORTED_TYPES.has(t.type)) return []; // cash and split entries are not exposed yet
      const schemeCode = schemeCodeOf(instrument.symbol);
      return [
        {
          id: t.id,
          accountId: t.portfolioId,
          accountName,
          instrumentKey: instrument.symbol,
          symbol: schemeCode ? null : instrument.symbol,
          schemeCode,
          name: instrument.name,
          type: t.type as Transaction['type'],
          tradeDate: t.tradeDate,
          quantity: clean(t.quantity),
          price: clean(t.price),
          fees: clean(t.fees) ?? '0',
          amount: clean(t.amount) ?? '0',
          currency: t.currency,
          notes: t.notes,
          createdAt: t.createdAt.toISOString(),
        },
      ];
    });
  }

  /**
   * Records a transaction after replaying the account's history for that
   * instrument with it included, so an impossible entry (selling units you
   * did not hold on that date) is rejected before it is stored.
   */
  async create(userId: string, input: CreateTransaction): Promise<Transaction> {
    if (input.tradeDate > today()) {
      throw new BadRequestError('The trade date cannot be in the future');
    }
    await this.accounts.get(userId, input.accountId);
    const instrument = await this.instruments.resolve(input.instrument);

    const id = await this.db.transaction(async (tx) => {
      await this.lockAccount(tx, input.accountId);
      const history = await this.entriesFor(tx, input.accountId, instrument);
      const draft: LedgerEntry = {
        id: 'new',
        instrumentKey: instrument.symbol, // same key as the stored history it is replayed with
        type: input.type,
        tradeDate: input.tradeDate,
        quantity: input.quantity,
        price: input.price,
        fees: input.fees,
        amount: input.amount,
      };
      this.assertValid([...history, draft]);

      const [row] = await tx
        .insert(transactions)
        .values({
          portfolioId: input.accountId,
          instrumentId: instrument.id,
          type: input.type,
          tradeDate: input.tradeDate,
          quantity: input.type === 'dividend' ? null : (input.quantity ?? null),
          price: input.type === 'dividend' ? null : (input.price ?? null),
          amount: cashFlowOf(draft).toFixed(4),
          fees: input.fees ?? '0',
          currency: instrument.currency,
          notes: input.notes || null,
        })
        .returning({ id: transactions.id });
      if (!row) {
        throw new Error('Transaction insert returned nothing');
      }
      return row.id;
    });

    const created = (await this.list(userId, input.accountId)).find((t) => t.id === id);
    if (!created) {
      throw new Error(`Created transaction ${id} but could not read it back`);
    }
    return created;
  }

  /** Deletes an entry unless a later entry depends on it (a sale of the units it bought). */
  async remove(userId: string, id: string): Promise<void> {
    const [row] = await this.db
      .select({
        portfolioId: transactions.portfolioId,
        instrumentId: transactions.instrumentId,
        symbol: instruments.symbol,
      })
      .from(transactions)
      .innerJoin(portfolios, eq(transactions.portfolioId, portfolios.id))
      .innerJoin(instruments, eq(transactions.instrumentId, instruments.id))
      .where(and(eq(transactions.id, id), eq(portfolios.userId, userId)));
    if (!row?.instrumentId) {
      throw new NotFoundError('Transaction not found');
    }
    const { portfolioId, instrumentId, symbol } = row;

    await this.db.transaction(async (tx) => {
      await this.lockAccount(tx, portfolioId);
      const remaining = (await this.entriesFor(tx, portfolioId, { id: instrumentId, symbol })).filter(
        (e) => e.id !== id,
      );
      this.assertValid(remaining, 'Deleting this would leave a later entry impossible: ');
      await tx.delete(transactions).where(eq(transactions.id, id));
    });
  }

  /**
   * Serializes writes per account: two simultaneous sales cannot both pass the
   * "enough units" check against the same history.
   */
  private async lockAccount(tx: Tx, accountId: string): Promise<void> {
    await tx.select({ id: portfolios.id }).from(portfolios).where(eq(portfolios.id, accountId)).for('update');
  }

  /** One account's history for one instrument, keyed by symbol so ledger errors read naturally. */
  private async entriesFor(
    db: DbOrTx,
    accountId: string,
    instrument: { id: string; symbol: string },
  ): Promise<LedgerEntry[]> {
    const rows = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.portfolioId, accountId), eq(transactions.instrumentId, instrument.id)))
      .orderBy(asc(transactions.createdAt));
    return rows
      .filter((r) => SUPPORTED_TYPES.has(r.type))
      .map((r) => ({
        id: r.id,
        instrumentKey: instrument.symbol,
        type: r.type as LedgerEntry['type'],
        tradeDate: r.tradeDate,
        quantity: r.quantity,
        price: r.price,
        fees: r.fees,
        // Stored dividends carry their gross amount in `amount` (fees are recorded separately).
        amount: r.type === 'dividend' ? new Decimal(r.amount).plus(r.fees).toString() : null,
      }));
  }

  private assertValid(entries: LedgerEntry[], prefix = ''): void {
    try {
      replay(entries);
    } catch (error) {
      if (error instanceof LedgerError) {
        throw new UnprocessableError(prefix + error.message);
      }
      throw error;
    }
  }
}

import type { Account, BrokerId, CreateAccount, UpdateAccount } from '@folio/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { Database } from './database.js';
import { ConflictError, isUniqueViolation, NotFoundError } from './errors.js';
import { brokerConnections, portfolios } from './schema.js';

type AccountRow = typeof portfolios.$inferSelect;

export function toAccount(row: AccountRow, syncedFrom: BrokerId | null = null): Account {
  return {
    id: row.id,
    name: row.name,
    broker: row.broker,
    currency: row.currency,
    syncedFrom,
    createdAt: row.createdAt.toISOString(),
  };
}

/** A brokerage account (Zerodha, Groww, a US broker). Stored in the portfolios table. */
export class AccountsService {
  constructor(private readonly db: Database) {}

  async list(userId: string): Promise<Account[]> {
    const rows = await this.db
      .select({ account: portfolios, syncedFrom: brokerConnections.broker })
      .from(portfolios)
      .leftJoin(brokerConnections, eq(brokerConnections.portfolioId, portfolios.id))
      .where(eq(portfolios.userId, userId))
      .orderBy(asc(portfolios.createdAt));
    return rows.map((r) => toAccount(r.account, r.syncedFrom));
  }

  async get(userId: string, id: string): Promise<AccountRow> {
    const [row] = await this.db
      .select()
      .from(portfolios)
      .where(and(eq(portfolios.id, id), eq(portfolios.userId, userId)));
    if (!row) {
      throw new NotFoundError('Account not found');
    }
    return row;
  }

  async create(userId: string, input: CreateAccount): Promise<Account> {
    try {
      const [row] = await this.db
        .insert(portfolios)
        .values({ userId, name: input.name, broker: input.broker ?? null, currency: input.currency })
        .returning();
      if (!row) {
        throw new Error('Account insert returned nothing');
      }
      return toAccount(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(`You already have an account called "${input.name}"`);
      }
      throw error;
    }
  }

  /** The broker an account syncs from, if any: its holdings come from there, not from recorded trades. */
  async syncedFrom(accountId: string): Promise<BrokerId | null> {
    const [row] = await this.db
      .select({ broker: brokerConnections.broker })
      .from(brokerConnections)
      .where(eq(brokerConnections.portfolioId, accountId));
    return row?.broker ?? null;
  }

  async update(userId: string, id: string, input: UpdateAccount): Promise<Account> {
    await this.get(userId, id);
    try {
      const [row] = await this.db
        .update(portfolios)
        .set({
          ...(input.name !== undefined && { name: input.name }),
          ...(input.broker !== undefined && { broker: input.broker || null }),
        })
        .where(and(eq(portfolios.id, id), eq(portfolios.userId, userId)))
        .returning();
      if (!row) {
        throw new NotFoundError('Account not found');
      }
      return toAccount(row, await this.syncedFrom(row.id));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(`You already have an account called "${input.name}"`);
      }
      throw error;
    }
  }

  /** Deletes the account and, through the foreign key cascade, all of its transactions. */
  async remove(userId: string, id: string): Promise<void> {
    const deleted = await this.db
      .delete(portfolios)
      .where(and(eq(portfolios.id, id), eq(portfolios.userId, userId)))
      .returning({ id: portfolios.id });
    if (deleted.length === 0) {
      throw new NotFoundError('Account not found');
    }
  }
}

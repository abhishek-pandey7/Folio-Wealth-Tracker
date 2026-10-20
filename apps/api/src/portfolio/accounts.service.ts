import type { Account, CreateAccount, UpdateAccount } from '@folio/shared';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { type Database, DRIZZLE } from '../database/database.module.js';
import { portfolios } from '../database/schema.js';

type AccountRow = typeof portfolios.$inferSelect;

export function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    broker: row.broker,
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Postgres reports unique violations as SQLSTATE 23505; Drizzle may wrap the driver error. */
function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e.code === '23505' || e.cause?.code === '23505';
}

/** A brokerage account (Zerodha, Groww, a US broker). Stored in the portfolios table. */
@Injectable()
export class AccountsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async list(userId: string): Promise<Account[]> {
    const rows = await this.db
      .select()
      .from(portfolios)
      .where(eq(portfolios.userId, userId))
      .orderBy(asc(portfolios.createdAt));
    return rows.map(toAccount);
  }

  async get(userId: string, id: string): Promise<AccountRow> {
    const [row] = await this.db
      .select()
      .from(portfolios)
      .where(and(eq(portfolios.id, id), eq(portfolios.userId, userId)));
    if (!row) {
      throw new NotFoundException('Account not found');
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
        throw new ConflictException(`You already have an account called "${input.name}"`);
      }
      throw error;
    }
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
        throw new NotFoundException('Account not found');
      }
      return toAccount(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(`You already have an account called "${input.name}"`);
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
      throw new NotFoundException('Account not found');
    }
  }
}

import type { StarRequest, WatchlistItem } from '@folio/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { type Database, DRIZZLE } from '../database/database.module.js';
import { instruments, watchlistItems } from '../database/schema.js';
import {
  FUND_PREFIX,
  type Instrument,
  InstrumentsService,
  parseSchemeCode,
  parseSymbol,
  schemeCodeOf,
} from '../instruments/instruments.service.js';

@Injectable()
export class WatchlistService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly instruments: InstrumentsService,
  ) {}

  async list(userId: string): Promise<WatchlistItem[]> {
    const rows = await this.db
      .select({
        symbol: instruments.symbol,
        name: instruments.name,
        assetClass: instruments.assetClass,
        currency: instruments.currency,
        starredAt: watchlistItems.createdAt,
      })
      .from(watchlistItems)
      .innerJoin(instruments, eq(watchlistItems.instrumentId, instruments.id))
      .where(eq(watchlistItems.userId, userId))
      .orderBy(asc(watchlistItems.createdAt), asc(instruments.symbol));

    return rows.map((row) => ({
      ...row,
      starredAt: row.starredAt.toISOString(),
      schemeCode: schemeCodeOf(row.symbol),
    }));
  }

  /** Idempotent: starring an already-starred symbol returns the existing item. */
  async star(userId: string, rawSymbol: string, request: StarRequest): Promise<WatchlistItem> {
    return this.starInstrument(userId, await this.instruments.resolveSymbol(rawSymbol, request));
  }

  /** Stars a mutual fund by scheme code. Name and category come from the fund data, not the client. */
  async starFund(userId: string, rawCode: string): Promise<WatchlistItem> {
    return this.starInstrument(userId, await this.instruments.resolveFund(rawCode));
  }

  /** Idempotent: unstarring something that is not starred is a no-op. */
  async unstar(userId: string, rawSymbol: string): Promise<void> {
    await this.remove(userId, parseSymbol(rawSymbol));
  }

  async unstarFund(userId: string, rawCode: string): Promise<void> {
    await this.remove(userId, `${FUND_PREFIX}${parseSchemeCode(rawCode)}`);
  }

  private async starInstrument(userId: string, instrument: Instrument): Promise<WatchlistItem> {
    await this.db.insert(watchlistItems).values({ userId, instrumentId: instrument.id }).onConflictDoNothing();

    const item = (await this.list(userId)).find((i) => i.symbol === instrument.symbol);
    if (!item) {
      throw new Error(`Starred ${instrument.symbol} but could not read it back`);
    }
    return item;
  }

  private async remove(userId: string, symbol: string): Promise<void> {
    const instrumentIds = this.db
      .select({ id: instruments.id })
      .from(instruments)
      .where(eq(instruments.symbol, symbol));

    await this.db
      .delete(watchlistItems)
      .where(and(eq(watchlistItems.userId, userId), inArray(watchlistItems.instrumentId, instrumentIds)));
  }
}

import {
  type AssetClass,
  QuoteSchema,
  type StarRequest,
  type SymbolMatch,
  SymbolSchema,
  type WatchlistItem,
} from '@folio/shared';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { type Database, DRIZZLE } from '../database/database.module.js';
import { instruments, watchlistItems } from '../database/schema.js';
import { MarketGatewayClient } from '../market/market-gateway.client.js';

const ASSET_CLASS_BY_TYPE: Record<SymbolMatch['type'], AssetClass> = {
  equity: 'equity',
  etf: 'etf',
  mutual_fund: 'mutual_fund',
  index: 'index',
};

@Injectable()
export class WatchlistService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly gateway: MarketGatewayClient,
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

    return rows.map((row) => ({ ...row, starredAt: row.starredAt.toISOString() }));
  }

  /** Idempotent: starring an already-starred symbol returns the existing item. */
  async star(userId: string, rawSymbol: string, request: StarRequest): Promise<WatchlistItem> {
    const symbol = this.parseSymbol(rawSymbol);

    // Pricing the symbol proves it exists and gives its currency; neither is taken from the client.
    const quote = await this.gateway.get(`/v1/quotes/${encodeURIComponent(symbol)}`, QuoteSchema);
    const name = request.name ?? quote.symbol;

    await this.db.transaction(async (tx) => {
      const [instrument] = await tx
        .insert(instruments)
        .values({
          symbol: quote.symbol,
          name,
          assetClass: request.type ? ASSET_CLASS_BY_TYPE[request.type] : 'equity',
          currency: quote.currency,
        })
        // Keep an existing name unless the client sent a real one.
        .onConflictDoUpdate({ target: instruments.symbol, set: request.name ? { name } : { symbol: quote.symbol } })
        .returning({ id: instruments.id });

      if (!instrument) {
        throw new Error(`Could not upsert instrument ${quote.symbol}`);
      }
      await tx.insert(watchlistItems).values({ userId, instrumentId: instrument.id }).onConflictDoNothing();
    });

    const item = (await this.list(userId)).find((i) => i.symbol === quote.symbol);
    if (!item) {
      throw new Error(`Starred ${quote.symbol} but could not read it back`);
    }
    return item;
  }

  /** Idempotent: unstarring something that is not starred is a no-op. */
  async unstar(userId: string, rawSymbol: string): Promise<void> {
    const symbol = this.parseSymbol(rawSymbol);
    const instrumentIds = this.db
      .select({ id: instruments.id })
      .from(instruments)
      .where(eq(instruments.symbol, symbol));

    await this.db
      .delete(watchlistItems)
      .where(and(eq(watchlistItems.userId, userId), inArray(watchlistItems.instrumentId, instrumentIds)));
  }

  private parseSymbol(raw: string): string {
    const parsed = SymbolSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException(`Invalid ticker symbol: ${raw}`);
    }
    return parsed.data;
  }
}

import {
  type AssetClass,
  FundSchema,
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

/**
 * Mutual funds have AMFI scheme codes, not tickers. They are stored as
 * instruments under a prefixed symbol so both live in one watchlist.
 */
const FUND_PREFIX = 'MF-';
const SCHEME_CODE = /^\d{1,8}$/;

type NewInstrument = typeof instruments.$inferInsert;

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

    return rows.map((row) => ({
      ...row,
      starredAt: row.starredAt.toISOString(),
      schemeCode: row.symbol.startsWith(FUND_PREFIX) ? row.symbol.slice(FUND_PREFIX.length) : null,
    }));
  }

  /** Idempotent: starring an already-starred symbol returns the existing item. */
  async star(userId: string, rawSymbol: string, request: StarRequest): Promise<WatchlistItem> {
    const symbol = this.parseSymbol(rawSymbol);

    // Pricing the symbol proves it exists and gives its currency; neither is taken from the client.
    const quote = await this.gateway.get(`/v1/quotes/${encodeURIComponent(symbol)}`, QuoteSchema);

    return this.upsertAndStar(
      userId,
      {
        symbol: quote.symbol,
        name: request.name ?? quote.symbol,
        assetClass: request.type ? ASSET_CLASS_BY_TYPE[request.type] : 'equity',
        currency: quote.currency,
      },
      // Keep an existing name unless the client sent a real one.
      request.name !== undefined,
    );
  }

  /** Stars a mutual fund by scheme code. Name and category come from the fund data, not the client. */
  async starFund(userId: string, rawCode: string): Promise<WatchlistItem> {
    const code = this.parseSchemeCode(rawCode);
    const fund = await this.gateway.get(`/v1/funds/${code}`, FundSchema);

    return this.upsertAndStar(
      userId,
      { symbol: `${FUND_PREFIX}${code}`, name: fund.name, assetClass: 'mutual_fund', currency: 'INR' },
      true,
    );
  }

  /** Idempotent: unstarring something that is not starred is a no-op. */
  async unstar(userId: string, rawSymbol: string): Promise<void> {
    await this.remove(userId, this.parseSymbol(rawSymbol));
  }

  async unstarFund(userId: string, rawCode: string): Promise<void> {
    await this.remove(userId, `${FUND_PREFIX}${this.parseSchemeCode(rawCode)}`);
  }

  private async upsertAndStar(userId: string, values: NewInstrument, updateName: boolean): Promise<WatchlistItem> {
    await this.db.transaction(async (tx) => {
      const [instrument] = await tx
        .insert(instruments)
        .values(values)
        .onConflictDoUpdate({
          target: instruments.symbol,
          set: updateName ? { name: values.name } : { symbol: values.symbol },
        })
        .returning({ id: instruments.id });

      if (!instrument) {
        throw new Error(`Could not upsert instrument ${values.symbol}`);
      }
      await tx.insert(watchlistItems).values({ userId, instrumentId: instrument.id }).onConflictDoNothing();
    });

    const item = (await this.list(userId)).find((i) => i.symbol === values.symbol);
    if (!item) {
      throw new Error(`Starred ${values.symbol} but could not read it back`);
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

  private parseSymbol(raw: string): string {
    const parsed = SymbolSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException(`Invalid ticker symbol: ${raw}`);
    }
    return parsed.data;
  }

  private parseSchemeCode(raw: string): string {
    const code = raw.trim();
    if (!SCHEME_CODE.test(code)) {
      throw new BadRequestException(`Invalid mutual fund scheme code: ${raw}`);
    }
    return code;
  }
}

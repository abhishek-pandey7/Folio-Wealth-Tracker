import {
  type AssetClass,
  FundSchema,
  type InstrumentRef,
  QuoteSchema,
  type SymbolMatch,
  SymbolSchema,
} from '@folio/shared';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { type Database, DRIZZLE } from '../database/database.module.js';
import { instruments } from '../database/schema.js';
import { MarketGatewayClient } from '../market/market-gateway.client.js';

const ASSET_CLASS_BY_TYPE: Record<SymbolMatch['type'], AssetClass> = {
  equity: 'equity',
  etf: 'etf',
  mutual_fund: 'mutual_fund',
  index: 'index',
};

/**
 * Mutual funds have AMFI scheme codes, not tickers. They are stored as
 * instruments under a prefixed symbol so one table covers everything.
 */
export const FUND_PREFIX = 'MF-';
const SCHEME_CODE = /^\d{1,8}$/;

export type Instrument = typeof instruments.$inferSelect;
type DbOrTx = Pick<Database, 'insert'>;

export function schemeCodeOf(symbol: string): string | null {
  return symbol.startsWith(FUND_PREFIX) ? symbol.slice(FUND_PREFIX.length) : null;
}

/**
 * Turns what a user picked (a ticker or a fund) into a stored instrument.
 * Existence and currency always come from market data, never from the client.
 */
@Injectable()
export class InstrumentsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly gateway: MarketGatewayClient,
  ) {}

  async resolve(ref: InstrumentRef, db: DbOrTx = this.db): Promise<Instrument> {
    return ref.kind === 'fund' ? this.resolveFund(ref.code, db) : this.resolveSymbol(ref.symbol, ref, db);
  }

  async resolveSymbol(
    rawSymbol: string,
    meta: { name?: string; type?: SymbolMatch['type'] } = {},
    db: DbOrTx = this.db,
  ): Promise<Instrument> {
    const symbol = parseSymbol(rawSymbol);
    const quote = await this.gateway.get(`/v1/quotes/${encodeURIComponent(symbol)}`, QuoteSchema);
    return this.upsert(
      db,
      {
        symbol: quote.symbol,
        name: meta.name ?? quote.symbol,
        assetClass: meta.type ? ASSET_CLASS_BY_TYPE[meta.type] : 'equity',
        currency: quote.currency,
      },
      meta.name !== undefined,
    );
  }

  async resolveFund(rawCode: string, db: DbOrTx = this.db): Promise<Instrument> {
    const code = parseSchemeCode(rawCode);
    const fund = await this.gateway.get(`/v1/funds/${code}`, FundSchema);
    return this.upsert(
      db,
      { symbol: `${FUND_PREFIX}${code}`, name: fund.name, assetClass: 'mutual_fund', currency: 'INR' },
      true,
    );
  }

  private async upsert(db: DbOrTx, values: typeof instruments.$inferInsert, updateName: boolean): Promise<Instrument> {
    const [row] = await db
      .insert(instruments)
      .values(values)
      // Keep an existing name unless a real one was supplied.
      .onConflictDoUpdate({
        target: instruments.symbol,
        set: updateName ? { name: values.name } : { symbol: values.symbol },
      })
      .returning();
    if (!row) {
      throw new Error(`Could not upsert instrument ${values.symbol}`);
    }
    return row;
  }
}

export function parseSymbol(raw: string): string {
  const parsed = SymbolSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestException(`Invalid ticker symbol: ${raw}`);
  }
  return parsed.data;
}

export function parseSchemeCode(raw: string): string {
  const code = raw.trim();
  if (!SCHEME_CODE.test(code)) {
    throw new BadRequestException(`Invalid mutual fund scheme code: ${raw}`);
  }
  return code;
}

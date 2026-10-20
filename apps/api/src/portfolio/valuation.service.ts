import {
  type AllocationSlice,
  type CashFlow,
  cashFlowOf,
  Decimal,
  FundScreenResultSchema,
  FxRateSchema,
  type Holding,
  type LedgerEntry,
  type PortfolioSummary,
  replay,
  ScreenResultSchema,
  xirr,
} from '@folio/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { type Database, DRIZZLE } from '../database/database.module.js';
import { instruments, portfolios, transactions } from '../database/schema.js';
import { type Instrument, schemeCodeOf } from '../instruments/instruments.service.js';
import { MarketGatewayClient } from '../market/market-gateway.client.js';

const BATCH = 50; // the gateway's per-screen limit

const ASSET_CLASS_LABELS: Record<string, string> = {
  equity: 'Stocks',
  etf: 'ETFs',
  mutual_fund: 'Mutual funds',
  index: 'Indices',
  bond: 'Bonds',
  gold: 'Gold',
  crypto: 'Crypto',
  cash: 'Cash',
};

interface LivePrice {
  price: Decimal;
  dayChangePct: number | null;
  sector: string | null;
}

interface Aggregate {
  instrument: Instrument;
  quantity: Decimal;
  costBasis: Decimal;
  realized: Decimal;
  dividends: Decimal;
  accounts: Set<string>;
  flows: CashFlow[];
}

const zero = () => new Decimal(0);
const money = (d: Decimal) => d.toFixed(2);
const pctOf = (part: Decimal, whole: Decimal) => (whole.isZero() ? null : part.dividedBy(whole).times(100).toNumber());
const round2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
const today = () => new Date().toISOString().slice(0, 10);

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Values the portfolio: replays each account's ledger, merges holdings of the
 * same instrument across accounts, prices them live and converts to rupees.
 *
 * Known simplification: USD amounts convert at today's USD/INR rate, so the
 * rupee cost of a US holding moves with the exchange rate.
 */
@Injectable()
export class ValuationService {
  private readonly logger = new Logger(ValuationService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly gateway: MarketGatewayClient,
  ) {}

  async summary(userId: string, accountId?: string): Promise<PortfolioSummary> {
    const rows = await this.db
      .select({ t: transactions, accountName: portfolios.name, instrument: instruments })
      .from(transactions)
      .innerJoin(portfolios, eq(transactions.portfolioId, portfolios.id))
      .innerJoin(instruments, eq(transactions.instrumentId, instruments.id))
      .where(and(eq(portfolios.userId, userId), accountId ? eq(portfolios.id, accountId) : undefined))
      .orderBy(asc(transactions.createdAt));

    // Replay per account: units held at Zerodha cannot be sold at Groww.
    const byAccount = new Map<string, { name: string; entries: LedgerEntry[] }>();
    const instrumentsById = new Map<string, Instrument>();
    const aggregates = new Map<string, Aggregate>();
    for (const { t, accountName, instrument } of rows) {
      if (t.type !== 'buy' && t.type !== 'sell' && t.type !== 'dividend') continue;
      instrumentsById.set(instrument.id, instrument);
      const account = byAccount.get(t.portfolioId) ?? { name: accountName, entries: [] };
      byAccount.set(t.portfolioId, account);
      const entry: LedgerEntry = {
        id: t.id,
        instrumentKey: instrument.id,
        type: t.type,
        tradeDate: t.tradeDate,
        quantity: t.quantity,
        price: t.price,
        fees: t.fees,
        amount: t.type === 'dividend' ? new Decimal(t.amount).plus(t.fees).toString() : null,
      };
      account.entries.push(entry);

      const agg = aggregates.get(instrument.id) ?? {
        instrument,
        quantity: zero(),
        costBasis: zero(),
        realized: zero(),
        dividends: zero(),
        accounts: new Set<string>(),
        flows: [],
      };
      aggregates.set(instrument.id, agg);
      agg.flows.push({ date: t.tradeDate, amount: cashFlowOf(entry) });
    }

    for (const { name, entries } of byAccount.values()) {
      for (const position of replay(entries).positions.values()) {
        const agg = aggregates.get(position.instrumentKey);
        if (!agg) continue;
        agg.quantity = agg.quantity.plus(position.quantity);
        agg.costBasis = agg.costBasis.plus(position.costBasis);
        agg.realized = agg.realized.plus(position.realizedGain);
        agg.dividends = agg.dividends.plus(position.dividends);
        if (position.quantity.greaterThan(0)) agg.accounts.add(name);
      }
    }

    const open = [...aggregates.values()].filter((a) => a.quantity.greaterThan(0));
    const [prices, usdInr] = await Promise.all([this.prices(open.map((a) => a.instrument)), this.usdInr()]);
    const toInr = (amount: Decimal, currency: string) => (currency === 'USD' ? amount.times(usdInr) : amount);

    const asOf = today();
    const holdings: Holding[] = open.map((a) => {
      const { instrument } = a;
      const live = prices.get(instrument.symbol);
      const value = live ? a.quantity.times(live.price) : a.costBasis;
      const valueInr = toInr(value, instrument.currency);
      const investedInr = toInr(a.costBasis, instrument.currency);
      const unrealizedInr = valueInr.minus(investedInr);
      const dayPct = live?.dayChangePct ?? null;
      // Today's change is the difference from yesterday's value: value - value / (1 + pct).
      const dayChangeInr =
        dayPct === null ? zero() : valueInr.minus(valueInr.dividedBy(new Decimal(dayPct).dividedBy(100).plus(1)));
      const schemeCode = schemeCodeOf(instrument.symbol);
      return {
        instrumentKey: instrument.symbol,
        symbol: schemeCode ? null : instrument.symbol,
        schemeCode,
        name: instrument.name,
        assetClass: instrument.assetClass,
        currency: instrument.currency,
        sector: live?.sector ?? null,
        accounts: [...a.accounts].sort(),
        quantity: a.quantity.toString(),
        avgCost: a.costBasis.dividedBy(a.quantity).toDecimalPlaces(4).toString(),
        price: live ? live.price.toString() : null,
        investedInr: money(investedInr),
        valueInr: money(valueInr),
        unrealizedInr: money(unrealizedInr),
        unrealizedPct: round2(pctOf(unrealizedInr, investedInr)),
        dayChangeInr: money(dayChangeInr),
        dayChangePct: dayPct,
        realizedInr: money(toInr(a.realized, instrument.currency)),
        dividendsInr: money(toInr(a.dividends, instrument.currency)),
        weight: 0,
        xirr: live ? round4(xirr([...a.flows, { date: asOf, amount: value }])) : null,
        priced: Boolean(live),
      };
    });

    const totalValue = holdings.reduce((sum, h) => sum.plus(h.valueInr), zero());
    for (const h of holdings) {
      h.weight = round2(pctOf(new Decimal(h.valueInr), totalValue)) ?? 0;
    }
    holdings.sort((a, b) => new Decimal(b.valueInr).comparedTo(a.valueInr));

    const all = [...aggregates.values()];
    const invested = holdings.reduce((sum, h) => sum.plus(h.investedInr), zero());
    const unrealized = totalValue.minus(invested);
    const dayChange = holdings.reduce((sum, h) => sum.plus(h.dayChangeInr), zero());
    const realized = all.reduce((sum, a) => sum.plus(toInr(a.realized, a.instrument.currency)), zero());
    const dividends = all.reduce((sum, a) => sum.plus(toInr(a.dividends, a.instrument.currency)), zero());
    const allFlows: CashFlow[] = all.flatMap((a) =>
      a.flows.map((f) => ({ date: f.date, amount: toInr(new Decimal(f.amount), a.instrument.currency) })),
    );

    return {
      asOf: new Date().toISOString(),
      usdInr: usdInr.toString(),
      totals: {
        valueInr: money(totalValue),
        investedInr: money(invested),
        unrealizedInr: money(unrealized),
        unrealizedPct: round2(pctOf(unrealized, invested)),
        realizedInr: money(realized),
        dividendsInr: money(dividends),
        dayChangeInr: money(dayChange),
        dayChangePct: round2(pctOf(dayChange, totalValue.minus(dayChange))),
        xirr:
          totalValue.isZero() && allFlows.length === 0
            ? null
            : round4(xirr([...allFlows, { date: asOf, amount: totalValue }])),
      },
      holdings,
      allocation: {
        assetClass: allocate(
          holdings,
          (h) => [h.assetClass, ASSET_CLASS_LABELS[h.assetClass] ?? h.assetClass],
          totalValue,
        ),
        market: allocate(holdings, (h) => (h.currency === 'USD' ? ['us', 'US'] : ['in', 'India']), totalValue),
        sector: allocate(
          holdings.filter((h) => h.assetClass === 'equity'),
          (h) => [h.sector ?? 'other', h.sector ?? 'Other'],
          totalValue,
        ),
      },
      transactionCount: rows.length,
    };
  }

  /** Live prices from the gateway: stocks via the screener (price, today's move, sector), funds via the fund screener. */
  private async prices(list: Instrument[]): Promise<Map<string, LivePrice>> {
    const out = new Map<string, LivePrice>();
    const symbols = list.filter((i) => !schemeCodeOf(i.symbol)).map((i) => i.symbol);
    const codes = list.flatMap((i) => schemeCodeOf(i.symbol) ?? []);

    const stockBatches = chunk(symbols, BATCH).map(async (batch) => {
      const res = await this.gateway.get(
        `/v1/screener?symbols=${encodeURIComponent(batch.join(','))}&period=1d&limit=100`,
        ScreenResultSchema,
        { timeoutMs: 45_000 },
      );
      for (const row of res.rows) {
        out.set(row.symbol, {
          price: new Decimal(row.price),
          dayChangePct: row.changePercent,
          sector: row.sector || null,
        });
      }
    });
    const fundBatches = chunk(codes, BATCH).map(async (batch) => {
      const res = await this.gateway.get(
        `/v1/funds/screener?codes=${encodeURIComponent(batch.join(','))}&period=1y&limit=100`,
        FundScreenResultSchema,
        { timeoutMs: 45_000 },
      );
      for (const row of res.rows) {
        out.set(`MF-${row.schemeCode}`, {
          price: new Decimal(row.nav),
          dayChangePct: row.metrics.returns['1d'],
          sector: null,
        });
      }
    });

    // A pricing outage must not hide the portfolio: unpriced holdings fall back to cost.
    const results = await Promise.allSettled([...stockBatches, ...fundBatches]);
    for (const r of results) {
      if (r.status === 'rejected') this.logger.warn(`Pricing batch failed: ${(r.reason as Error).message}`);
    }
    return out;
  }

  private async usdInr(): Promise<Decimal> {
    const fx = await this.gateway.get('/v1/fx?base=USD&quote=INR', FxRateSchema);
    return new Decimal(fx.rate);
  }
}

function round4(n: number | null): number | null {
  return n === null ? null : Math.round(n * 10_000) / 10_000;
}

function allocate(holdings: Holding[], keyOf: (h: Holding) => [string, string], total: Decimal): AllocationSlice[] {
  const slices = new Map<string, { label: string; value: Decimal }>();
  for (const h of holdings) {
    const [key, label] = keyOf(h);
    const slice = slices.get(key) ?? { label, value: zero() };
    slice.value = slice.value.plus(h.valueInr);
    slices.set(key, slice);
  }
  return [...slices]
    .map(([key, { label, value }]) => ({
      key,
      label,
      valueInr: money(value),
      weight: round2(pctOf(value, total)) ?? 0,
    }))
    .sort((a, b) => b.weight - a.weight);
}

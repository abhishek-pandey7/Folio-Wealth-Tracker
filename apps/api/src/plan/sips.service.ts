import {
  type CreateSip,
  Decimal,
  NavOnSchema,
  nextSipDate,
  type Sip,
  sipDueDates,
  sipPurchase,
  type UpdateSip,
} from '@folio/shared';
import { Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { and, asc, count, eq, inArray, sum } from 'drizzle-orm';
import { z } from 'zod';
import { type Database, DRIZZLE } from '../database/database.module.js';
import { goals, instruments, portfolios, sips, transactions } from '../database/schema.js';
import { InstrumentsService, schemeCodeOf } from '../instruments/instruments.service.js';
import { MarketGatewayClient } from '../market/market-gateway.client.js';

const today = () => new Date().toISOString().slice(0, 10);

function firstOfNextMonth(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

/** Catch-up is cheap (cached NAVs, idempotent inserts) but not free; reads trigger it at most this often. */
const CATCH_UP_INTERVAL_MS = 10 * 60_000;

type SipRow = typeof sips.$inferSelect;

@Injectable()
export class SipsService {
  private readonly logger = new Logger(SipsService.name);
  private readonly lastCatchUp = new Map<string, number>();

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly instruments: InstrumentsService,
    private readonly gateway: MarketGatewayClient,
  ) {}

  async list(userId: string): Promise<Sip[]> {
    const rows = await this.db
      .select({ sip: sips, fund: instruments, accountName: portfolios.name, goalName: goals.name })
      .from(sips)
      .innerJoin(instruments, eq(sips.instrumentId, instruments.id))
      .innerJoin(portfolios, eq(sips.portfolioId, portfolios.id))
      .leftJoin(goals, eq(sips.goalId, goals.id))
      .where(eq(sips.userId, userId))
      .orderBy(asc(sips.createdAt));
    if (rows.length === 0) return [];

    const totals = await this.db
      .select({ sipId: transactions.sipId, instalments: count(), invested: sum(transactions.amount) })
      .from(transactions)
      .where(
        inArray(
          transactions.sipId,
          rows.map((r) => r.sip.id),
        ),
      )
      .groupBy(transactions.sipId);
    const bySip = new Map(totals.map((t) => [t.sipId, t]));
    const now = today();

    return rows.map(({ sip, fund, accountName, goalName }) => {
      const t = bySip.get(sip.id);
      return {
        id: sip.id,
        accountId: sip.portfolioId,
        accountName,
        schemeCode: schemeCodeOf(fund.symbol) ?? fund.symbol,
        fundName: fund.name,
        amount: new Decimal(sip.amount).toString(),
        dayOfMonth: sip.dayOfMonth,
        startDate: sip.startDate,
        status: sip.status,
        goalId: sip.goalId,
        goalName,
        instalments: t?.instalments ?? 0,
        // Instalments are stored as negative cash flows; invested is the positive total.
        investedInr: new Decimal(t?.invested ?? 0).negated().toFixed(2),
        nextDue: sip.status === 'active' ? nextSipDate(sip.activeFrom, sip.dayOfMonth, now) : null,
        createdAt: sip.createdAt.toISOString(),
      };
    });
  }

  async create(userId: string, input: CreateSip): Promise<Sip> {
    await this.assertOwned(userId, input.accountId, input.goalId);
    const fund = await this.instruments.resolveFund(input.schemeCode);

    const [row] = await this.db
      .insert(sips)
      .values({
        userId,
        portfolioId: input.accountId,
        instrumentId: fund.id,
        goalId: input.goalId ?? null,
        amount: input.amount,
        dayOfMonth: input.dayOfMonth,
        startDate: input.startDate,
        activeFrom: input.startDate,
      })
      .returning();
    if (!row) throw new Error('SIP insert returned nothing');

    // A start date in the past backfills every instalment since then, at each date's real NAV.
    await this.record(row, fund.symbol);
    return this.get(userId, row.id);
  }

  async update(userId: string, id: string, input: UpdateSip): Promise<Sip> {
    const current = await this.owned(userId, id);
    if (input.goalId) await this.assertOwned(userId, current.portfolioId, input.goalId);
    if (current.status === 'stopped' && input.status && input.status !== 'stopped') {
      throw new UnprocessableEntityException('A stopped SIP cannot restart. Start a new SIP instead.');
    }

    // When the schedule restarts. Recorded instalments are never rewritten (the unique index
    // protects them); these rules stop new ones being invented for the past:
    //  - resuming skips the paused months, so it starts today;
    //  - a new SIP day starts next month, like an AMC applies it, so no month gets two instalments;
    //  - a new amount needs no change: only instalments not yet recorded use it.
    const resuming = input.status === 'active' && current.status === 'paused';
    const newDay = input.dayOfMonth !== undefined && input.dayOfMonth !== current.dayOfMonth;
    const restartFrom = newDay ? firstOfNextMonth(today()) : resuming ? today() : null;

    await this.db
      .update(sips)
      .set({
        ...(input.amount !== undefined && { amount: input.amount }),
        ...(input.dayOfMonth !== undefined && { dayOfMonth: input.dayOfMonth }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.goalId !== undefined && { goalId: input.goalId }),
        ...(restartFrom && restartFrom > current.activeFrom && { activeFrom: restartFrom }),
      })
      .where(eq(sips.id, id));
    return this.get(userId, id);
  }

  /** Deletes the SIP; instalments already recorded stay, because they happened. */
  async remove(userId: string, id: string): Promise<void> {
    await this.owned(userId, id);
    await this.db.delete(sips).where(eq(sips.id, id));
  }

  /**
   * Records every due instalment whose NAV is published. Safe to run any number
   * of times, concurrently or not: the (sip_id, trade_date) unique index turns
   * repeats into no-ops. Reads call this throttled; a daily cron calls runAll.
   */
  async catchUp(userId: string, force = false): Promise<number> {
    const last = this.lastCatchUp.get(userId) ?? 0;
    if (!force && Date.now() - last < CATCH_UP_INTERVAL_MS) return 0;
    this.lastCatchUp.set(userId, Date.now());

    const rows = await this.db
      .select({ sip: sips, symbol: instruments.symbol })
      .from(sips)
      .innerJoin(instruments, eq(sips.instrumentId, instruments.id))
      .where(and(eq(sips.userId, userId), eq(sips.status, 'active')));

    let recorded = 0;
    for (const { sip, symbol } of rows) {
      try {
        recorded += await this.record(sip, symbol);
      } catch (error) {
        // One fund's NAV source failing must not stop the others; the next run retries.
        this.logger.warn(`SIP ${sip.id} catch-up failed: ${(error as Error).message}`);
      }
    }
    return recorded;
  }

  async runAll(): Promise<{ users: number; recorded: number }> {
    const users = await this.db.selectDistinct({ userId: sips.userId }).from(sips).where(eq(sips.status, 'active'));
    let recorded = 0;
    for (const { userId } of users) {
      recorded += await this.catchUp(userId, true);
    }
    return { users: users.length, recorded };
  }

  private async record(sip: SipRow, symbol: string): Promise<number> {
    const due = sipDueDates(sip.activeFrom, sip.dayOfMonth, today());
    const code = schemeCodeOf(symbol);
    if (due.length === 0 || !code) return 0;

    // One request covers up to 400 instalments (33 years of a monthly SIP).
    const dates = due.slice(-400);
    const navs = await this.gateway.get(`/v1/funds/${code}/navs?on=${dates.join(',')}`, z.array(NavOnSchema));

    const values = navs.flatMap((n) => {
      const { units, price, residual } = sipPurchase(sip.amount, n.nav);
      if (units.isZero()) return [];
      return [
        {
          portfolioId: sip.portfolioId,
          instrumentId: sip.instrumentId,
          type: 'buy' as const,
          tradeDate: n.date,
          quantity: units.toString(),
          price: price.toString(),
          fees: residual.toFixed(4),
          amount: new Decimal(sip.amount).negated().toFixed(4),
          currency: 'INR' as const,
          notes: 'SIP instalment',
          sipId: sip.id,
        },
      ];
    });
    if (values.length === 0) return 0;

    const inserted = await this.db
      .insert(transactions)
      .values(values)
      .onConflictDoNothing({ target: [transactions.sipId, transactions.tradeDate] })
      .returning({ id: transactions.id });
    return inserted.length;
  }

  private async get(userId: string, id: string): Promise<Sip> {
    const sip = (await this.list(userId)).find((s) => s.id === id);
    if (!sip) throw new NotFoundException('SIP not found');
    return sip;
  }

  private async owned(userId: string, id: string): Promise<SipRow> {
    const [row] = await this.db
      .select()
      .from(sips)
      .where(and(eq(sips.id, id), eq(sips.userId, userId)));
    if (!row) throw new NotFoundException('SIP not found');
    return row;
  }

  private async assertOwned(userId: string, accountId: string, goalId?: string): Promise<void> {
    const [account] = await this.db
      .select({ id: portfolios.id })
      .from(portfolios)
      .where(and(eq(portfolios.id, accountId), eq(portfolios.userId, userId)));
    if (!account) throw new NotFoundException('Account not found');
    if (goalId) {
      const [goal] = await this.db
        .select({ id: goals.id })
        .from(goals)
        .where(and(eq(goals.id, goalId), eq(goals.userId, userId)));
      if (!goal) throw new NotFoundException('Goal not found');
    }
  }
}

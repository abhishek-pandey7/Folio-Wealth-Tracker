import {
  type CreateGoal,
  Decimal,
  type Goal,
  monthsBetween,
  projectGoal,
  type SetGoalHoldings,
  type UpdateGoal,
} from '@folio/shared';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import type { Database } from './database.js';
import { ConflictError, isUniqueViolation, NotFoundError, UnprocessableError } from './errors.js';
import { goalHoldings, goals, instruments, portfolios, sips, transactions } from './schema.js';
import type { ValuationService } from './valuation.js';

const today = () => new Date().toISOString().slice(0, 10);

export class GoalsService {
  constructor(
    private readonly db: Database,
    private readonly valuation: ValuationService,
  ) {}

  async list(userId: string): Promise<Goal[]> {
    const rows = await this.db.select().from(goals).where(eq(goals.userId, userId)).orderBy(asc(goals.createdAt));
    if (rows.length === 0) return [];
    const ids = rows.map((g) => g.id);

    const [links, linkedSips, summary] = await Promise.all([
      this.db
        .select({
          goalId: goalHoldings.goalId,
          share: goalHoldings.share,
          symbol: instruments.symbol,
          name: instruments.name,
        })
        .from(goalHoldings)
        .innerJoin(instruments, eq(goalHoldings.instrumentId, instruments.id))
        .where(inArray(goalHoldings.goalId, ids)),
      this.db
        .select({
          id: sips.id,
          goalId: sips.goalId,
          amount: sips.amount,
          status: sips.status,
          fundName: instruments.name,
        })
        .from(sips)
        .innerJoin(instruments, eq(sips.instrumentId, instruments.id))
        .where(inArray(sips.goalId, ids)),
      this.valuation.summary(userId),
    ]);
    const valueByKey = new Map(summary.holdings.map((h) => [h.instrumentKey, new Decimal(h.valueInr)]));

    return rows.map((goal) => {
      const holdings = links
        .filter((l) => l.goalId === goal.id)
        .map((l) => {
          const share = Number(l.share);
          // A sold holding contributes nothing, but the link is kept so it is visible.
          const value = (valueByKey.get(l.symbol) ?? new Decimal(0)).times(share);
          return { instrumentKey: l.symbol, name: l.name, share, valueInr: value.toFixed(2) };
        });
      const goalSips = linkedSips
        .filter((s) => s.goalId === goal.id)
        .map((s) => ({ id: s.id, fundName: s.fundName, amount: new Decimal(s.amount).toString(), status: s.status }));

      const current = holdings.reduce((sum, h) => sum.plus(h.valueInr), new Decimal(0));
      const monthly = goalSips
        .filter((s) => s.status === 'active')
        .reduce((sum, s) => sum.plus(s.amount), new Decimal(0));
      const target = new Decimal(goal.targetAmount);
      const assumedReturn = Number(goal.assumedReturn);
      const monthsLeft = goal.targetDate ? monthsBetween(today(), goal.targetDate) : null;
      const projection =
        monthsLeft === null
          ? null
          : projectGoal({
              current: current.toNumber(),
              monthly: monthly.toNumber(),
              annualReturn: assumedReturn,
              months: monthsLeft,
              target: target.toNumber(),
            });

      return {
        id: goal.id,
        name: goal.name,
        targetAmount: target.toFixed(2),
        targetDate: goal.targetDate,
        assumedReturn,
        createdAt: goal.createdAt.toISOString(),
        currentInr: current.toFixed(2),
        progressPct: target.isZero()
          ? 0
          : Math.min(100, Math.round(current.dividedBy(target).times(1000).toNumber()) / 10),
        monthlySipInr: monthly.toFixed(2),
        monthsLeft,
        projectedInr: projection ? projection.projected.toFixed(2) : null,
        requiredMonthlyInr: projection ? projection.requiredMonthly.toFixed(2) : null,
        onTrack: projection ? projection.projected >= target.toNumber() : null,
        holdings,
        sips: goalSips,
      };
    });
  }

  async create(userId: string, input: CreateGoal): Promise<Goal> {
    if (input.targetDate && input.targetDate <= today()) {
      throw new UnprocessableError('The target date should be in the future');
    }
    try {
      const [row] = await this.db
        .insert(goals)
        .values({
          userId,
          name: input.name,
          targetAmount: input.targetAmount,
          targetDate: input.targetDate ?? null,
          assumedReturn: input.assumedReturn.toFixed(4),
        })
        .returning({ id: goals.id });
      if (!row) throw new Error('Goal insert returned nothing');
      return this.get(userId, row.id);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError(`You already have a goal called "${input.name}"`);
      throw error;
    }
  }

  async update(userId: string, id: string, input: UpdateGoal): Promise<Goal> {
    await this.owned(userId, id);
    try {
      await this.db
        .update(goals)
        .set({
          ...(input.name !== undefined && { name: input.name }),
          ...(input.targetAmount !== undefined && { targetAmount: input.targetAmount }),
          ...(input.targetDate !== undefined && { targetDate: input.targetDate }),
          ...(input.assumedReturn !== undefined && { assumedReturn: input.assumedReturn.toFixed(4) }),
        })
        .where(eq(goals.id, id));
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError(`You already have a goal called "${input.name}"`);
      throw error;
    }
    return this.get(userId, id);
  }

  /** Deleting a goal unlinks its holdings and SIPs; nothing else changes. */
  async remove(userId: string, id: string): Promise<void> {
    await this.owned(userId, id);
    await this.db.delete(goals).where(eq(goals.id, id));
  }

  /**
   * Replaces the holdings counted toward a goal. A holding can be split across
   * goals, but never assigned more than 100% in total.
   */
  async setHoldings(userId: string, id: string, input: SetGoalHoldings): Promise<Goal> {
    await this.owned(userId, id);
    const keys = [...new Set(input.holdings.map((h) => h.instrumentKey))];

    const known = keys.length
      ? await this.db
          .selectDistinct({ id: instruments.id, symbol: instruments.symbol })
          .from(instruments)
          .innerJoin(transactions, eq(transactions.instrumentId, instruments.id))
          .innerJoin(portfolios, eq(transactions.portfolioId, portfolios.id))
          .where(and(eq(portfolios.userId, userId), inArray(instruments.symbol, keys)))
      : [];
    const idOf = new Map(known.map((k) => [k.symbol, k.id]));
    const missing = keys.filter((k) => !idOf.has(k));
    if (missing.length) {
      throw new UnprocessableError(`You have no transactions in ${missing.join(', ')}`);
    }

    const elsewhere = keys.length
      ? await this.db
          .select({ symbol: instruments.symbol, share: goalHoldings.share, goal: goals.name })
          .from(goalHoldings)
          .innerJoin(goals, eq(goalHoldings.goalId, goals.id))
          .innerJoin(instruments, eq(goalHoldings.instrumentId, instruments.id))
          .where(and(eq(goals.userId, userId), ne(goals.id, id), inArray(instruments.symbol, keys)))
      : [];
    for (const h of input.holdings) {
      const others = elsewhere.filter((e) => e.symbol === h.instrumentKey);
      const used = others.reduce((sum, e) => sum + Number(e.share), 0);
      if (used + h.share > 1.0001) {
        const where = others.map((o) => `${Math.round(Number(o.share) * 100)}% to ${o.goal}`).join(', ');
        throw new UnprocessableError(
          `${h.instrumentKey} is already assigned ${where}; at most ${Math.round((1 - used) * 100)}% is left`,
        );
      }
    }

    await this.db.transaction(async (tx) => {
      await tx.delete(goalHoldings).where(eq(goalHoldings.goalId, id));
      if (input.holdings.length) {
        await tx.insert(goalHoldings).values(
          input.holdings.map((h) => ({
            goalId: id,
            instrumentId: idOf.get(h.instrumentKey) as string,
            share: h.share.toFixed(4),
          })),
        );
      }
    });
    return this.get(userId, id);
  }

  private async get(userId: string, id: string): Promise<Goal> {
    const goal = (await this.list(userId)).find((g) => g.id === id);
    if (!goal) throw new NotFoundError('Goal not found');
    return goal;
  }

  private async owned(userId: string, id: string): Promise<void> {
    const [row] = await this.db
      .select({ id: goals.id })
      .from(goals)
      .where(and(eq(goals.id, id), eq(goals.userId, userId)));
    if (!row) throw new NotFoundError('Goal not found');
  }
}

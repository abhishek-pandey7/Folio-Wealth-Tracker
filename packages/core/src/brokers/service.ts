import {
  BROKER_CURRENCY,
  BROKER_IDS,
  BROKER_LOGIN,
  BROKER_NAMES,
  type Broker,
  type BrokerId,
  type Brokers,
  Decimal,
} from '@folio/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../database.js';
import { AppError, BadRequestError, ConflictError, NotFoundError, UnavailableError } from '../errors.js';
import { consoleLogger, type Logger } from '../logger.js';
import { brokerConnections, brokerHoldings, instruments, portfolios } from '../schema.js';
import { TokenCipher } from './cipher.js';
import { BrokerRequestError } from './http.js';
import { assetClassOf, yahooSymbol } from './symbols.js';
import type { BrokerAdapter, BrokerHolding } from './types.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Connection = typeof brokerConnections.$inferSelect & { accountName: string; holdings: number };

interface Matched {
  symbol: string;
  name: string;
  currency: 'INR' | 'USD';
  quantity: Decimal;
  cost: Decimal;
  lastPrice: Decimal | null;
}

export interface BrokersOptions {
  /** Adapters for the brokers this deployment has API keys for. */
  adapters: BrokerAdapter[];
  /** The secret the session-token encryption key is derived from. Broker sync is off without one. */
  secret: string | null;
  logger?: Logger;
  now?: () => Date;
}

const LOGIN_AGAIN = 'Log in again to refresh your holdings.';

/**
 * Read-only broker sync. A login stores the broker's session token
 * (encrypted) against an account; a sync replaces that account's holdings
 * snapshot with what the broker reports. Valuation then prices the snapshot
 * live like any other holding, so values move all day even though the
 * holdings themselves only change when the owner trades.
 */
export class BrokersService {
  private readonly adapters: Map<BrokerId, BrokerAdapter>;
  private readonly logger: Logger;
  private readonly now: () => Date;
  private cipherKey?: Promise<TokenCipher>;

  constructor(
    private readonly db: Database,
    private readonly options: BrokersOptions,
  ) {
    this.adapters = new Map(options.adapters.map((a) => [a.id, a]));
    this.logger = options.logger ?? consoleLogger;
    this.now = options.now ?? (() => new Date());
  }

  get enabled(): boolean {
    return Boolean(this.options.secret);
  }

  async list(userId: string): Promise<Brokers> {
    const rows = await this.connections(userId);
    return { enabled: this.enabled, brokers: BROKER_IDS.map((id) => this.describe(id, rows.get(id) ?? null)) };
  }

  async get(userId: string, id: BrokerId): Promise<Broker> {
    return this.describe(id, (await this.connections(userId, id)).get(id) ?? null);
  }

  /** The broker's login page, plus encrypted state the browser hands back to completeLogin. */
  async startLogin(id: BrokerId, redirectUri: string, state: string): Promise<{ url: string; carry: string | null }> {
    const adapter = this.adapter(id);
    const cipher = await this.cipher();
    if (!adapter.startLogin) {
      throw new BadRequestError(`${BROKER_NAMES[id]} logs in with your client code, PIN and authenticator code`);
    }
    const start = await adapter.startLogin(redirectUri, state);
    return { url: start.url, carry: start.carry ? await cipher.encrypt(start.carry) : null };
  }

  async completeLogin(
    userId: string,
    id: BrokerId,
    params: Record<string, string>,
    redirectUri: string,
    carry: string | null = null,
  ): Promise<Broker> {
    const adapter = this.adapter(id);
    const cipher = await this.cipher();
    const opened = carry ? await cipher.decrypt(carry) : null;
    if (carry && !opened) throw new BadRequestError('This login has expired; start it again');

    const session = await adapter.completeLogin(params, redirectUri, opened).catch((error: unknown) => {
      if (error instanceof BrokerRequestError) {
        throw new BadRequestError(`${BROKER_NAMES[id]} did not accept the login (${error.message})`);
      }
      throw error;
    });

    const values = {
      accessToken: await cipher.encrypt(session.accessToken),
      tokenExpiresAt: session.expiresAt,
      refresh: session.refresh ? await cipher.encrypt(session.refresh) : null,
      brokerUserName: session.userName,
      syncError: null,
    };
    await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: brokerConnections.id })
        .from(brokerConnections)
        .where(and(eq(brokerConnections.userId, userId), eq(brokerConnections.broker, id)))
        .for('update');
      if (existing) {
        await tx.update(brokerConnections).set(values).where(eq(brokerConnections.id, existing.id));
      } else {
        const portfolioId = await this.createAccount(tx, userId, id);
        await tx.insert(brokerConnections).values({ ...values, userId, broker: id, portfolioId });
      }
    });
    return this.sync(userId, id);
  }

  /** Replaces the account's holdings with what the broker reports now. Failures are recorded, not thrown. */
  async sync(userId: string, id: BrokerId): Promise<Broker> {
    const adapter = this.adapter(id);
    const row = (await this.connections(userId, id)).get(id);
    if (!row) throw new NotFoundError(`${BROKER_NAMES[id]} is not connected`);

    const token = await this.session(row, adapter);
    if (!token) return this.get(userId, id);

    let reported: BrokerHolding[];
    try {
      reported = await adapter.holdings(token);
    } catch (error) {
      if (error instanceof BrokerRequestError && error.sessionExpired) {
        await this.expire(row.id, `${BROKER_NAMES[id]} ended the session. ${LOGIN_AGAIN}`);
      } else {
        this.logger.warn(`${id} holdings sync failed: ${(error as Error).message}`);
        await this.recordError(row.id, error);
      }
      return this.get(userId, id);
    }

    const { matched, unmatched } = match(reported);
    await this.db.transaction(async (tx) => {
      // Concurrent syncs of one broker run one after the other, so each replaces the snapshot whole.
      await tx
        .select({ id: brokerConnections.id })
        .from(brokerConnections)
        .where(eq(brokerConnections.id, row.id))
        .for('update');
      const ids = await upsertInstruments(tx, matched);
      await tx.delete(brokerHoldings).where(eq(brokerHoldings.portfolioId, row.portfolioId));
      const holdings = matched.flatMap((h) => {
        const instrumentId = ids.get(h.symbol);
        return instrumentId
          ? [
              {
                portfolioId: row.portfolioId,
                instrumentId,
                quantity: h.quantity.toFixed(6),
                avgCost: h.cost.dividedBy(h.quantity).toFixed(4),
                lastPrice: h.lastPrice?.toFixed(4) ?? null,
              },
            ]
          : [];
      });
      if (holdings.length) await tx.insert(brokerHoldings).values(holdings);
      await tx
        .update(brokerConnections)
        .set({
          syncedAt: this.now(),
          syncError: unmatched.length ? `Not shown (no market symbol found): ${unmatched.join(', ')}` : null,
        })
        .where(eq(brokerConnections.id, row.id));
    });
    return this.get(userId, id);
  }

  /** Syncs every broker whose session is live and whose last sync is older than maxAgeMs. */
  async syncStale(userId: string, maxAgeMs: number): Promise<Brokers> {
    if (!this.enabled) return this.list(userId);
    const now = this.now().getTime();
    for (const row of (await this.connections(userId)).values()) {
      if (!this.adapters.has(row.broker) || !this.isActive(row)) continue;
      if (row.syncedAt && now - row.syncedAt.getTime() < maxAgeMs) continue;
      await this.sync(userId, row.broker).catch((error: unknown) => {
        this.logger.warn(`${row.broker} sync failed: ${(error as Error).message}`);
      });
    }
    return this.list(userId);
  }

  /** Removes the connection, its account and its holdings from Folio. Nothing changes at the broker. */
  async disconnect(userId: string, id: BrokerId): Promise<void> {
    const row = (await this.connections(userId, id)).get(id);
    if (!row) throw new NotFoundError(`${BROKER_NAMES[id]} is not connected`);
    await this.db.delete(portfolios).where(and(eq(portfolios.id, row.portfolioId), eq(portfolios.userId, userId)));
  }

  /** A usable session token: the stored one while it lasts, else a renewed one where the broker allows it. */
  private async session(row: Connection, adapter: BrokerAdapter): Promise<string | null> {
    const cipher = await this.cipher();
    if (row.accessToken && row.tokenExpiresAt && row.tokenExpiresAt > this.now()) {
      const token = await cipher.decrypt(row.accessToken);
      if (token) return token;
    }
    const refresh = row.refresh && adapter.refresh ? await cipher.decrypt(row.refresh) : null;
    if (refresh && adapter.refresh) {
      try {
        const renewed = await adapter.refresh(refresh);
        await this.db
          .update(brokerConnections)
          .set({
            accessToken: await cipher.encrypt(renewed.accessToken),
            tokenExpiresAt: renewed.expiresAt,
            refresh: renewed.refresh ? await cipher.encrypt(renewed.refresh) : row.refresh,
            syncError: null,
          })
          .where(eq(brokerConnections.id, row.id));
        return renewed.accessToken;
      } catch (error) {
        if (!(error instanceof BrokerRequestError && error.sessionExpired)) {
          // A network blip: keep the refresh token and try again on the next sync.
          await this.recordError(row.id, error);
          return null;
        }
      }
    }
    if (row.accessToken || row.refresh) await this.expire(row.id, LOGIN_AGAIN);
    return null;
  }

  private isActive(row: Connection): boolean {
    const live = Boolean(row.accessToken && row.tokenExpiresAt && row.tokenExpiresAt > this.now());
    return live || Boolean(row.refresh && this.adapters.get(row.broker)?.refresh);
  }

  private async expire(connectionId: string, message: string): Promise<void> {
    await this.db
      .update(brokerConnections)
      .set({ accessToken: null, refresh: null, syncError: message })
      .where(eq(brokerConnections.id, connectionId));
  }

  private async recordError(connectionId: string, error: unknown): Promise<void> {
    // Only messages Folio wrote reach the page; anything unexpected stays in the logs.
    const message = error instanceof AppError ? error.message : 'The sync failed; Folio will try again later.';
    await this.db.update(brokerConnections).set({ syncError: message }).where(eq(brokerConnections.id, connectionId));
  }

  /** An account named after the broker, or "<broker> (synced)" if the owner already has one by that name. */
  private async createAccount(tx: Tx, userId: string, id: BrokerId): Promise<string> {
    const base = BROKER_NAMES[id];
    for (const name of [base, `${base} (synced)`, `${base} (synced ${this.now().getTime() % 10_000})`]) {
      const [row] = await tx
        .insert(portfolios)
        .values({ userId, name, broker: base, currency: BROKER_CURRENCY[id] })
        .onConflictDoNothing()
        .returning({ id: portfolios.id });
      if (row) return row.id;
    }
    throw new ConflictError(`Could not create an account for ${base}; rename your existing ${base} account`);
  }

  private async connections(userId: string, id?: BrokerId): Promise<Map<BrokerId, Connection>> {
    const rows = await this.db
      .select({
        connection: brokerConnections,
        accountName: portfolios.name,
        holdings:
          sql<number>`(select count(*) from ${brokerHoldings} where ${brokerHoldings.portfolioId} = ${brokerConnections.portfolioId})`.mapWith(
            Number,
          ),
      })
      .from(brokerConnections)
      .innerJoin(portfolios, eq(portfolios.id, brokerConnections.portfolioId))
      .where(and(eq(brokerConnections.userId, userId), id ? eq(brokerConnections.broker, id) : undefined));
    return new Map(
      rows.map((r) => [r.connection.broker, { ...r.connection, accountName: r.accountName, holdings: r.holdings }]),
    );
  }

  private describe(id: BrokerId, row: Connection | null): Broker {
    const adapter = this.adapters.get(id);
    return {
      id,
      name: BROKER_NAMES[id],
      login: BROKER_LOGIN[id],
      configured: Boolean(adapter),
      connection: row && {
        accountId: row.portfolioId,
        accountName: row.accountName,
        userName: row.brokerUserName,
        status: this.isActive(row) ? 'active' : 'expired',
        renews: Boolean(row.refresh && adapter?.refresh),
        expiresAt: row.tokenExpiresAt?.toISOString() ?? null,
        syncedAt: row.syncedAt?.toISOString() ?? null,
        error: row.syncError,
        holdings: row.holdings,
      },
    };
  }

  private adapter(id: BrokerId): BrokerAdapter {
    if (!this.enabled) throw new UnavailableError('Broker sync is not set up on this deployment');
    const adapter = this.adapters.get(id);
    if (!adapter) throw new UnavailableError(`${BROKER_NAMES[id]} is not set up on this deployment yet`);
    return adapter;
  }

  private cipher(): Promise<TokenCipher> {
    const secret = this.options.secret;
    if (!secret) return Promise.reject(new UnavailableError('Broker sync is not set up on this deployment'));
    this.cipherKey ??= TokenCipher.fromSecret(secret);
    return this.cipherKey;
  }
}

/** Matches broker holdings to market symbols, merging any the broker lists twice (NSE and BSE). */
export function match(reported: BrokerHolding[]): { matched: Matched[]; unmatched: string[] } {
  const matched = new Map<string, Matched>();
  const unmatched: string[] = [];
  for (const h of reported) {
    const symbol = yahooSymbol(h.tradingSymbol, h.exchange);
    if (!symbol) {
      unmatched.push(h.tradingSymbol);
      continue;
    }
    const entry = matched.get(symbol) ?? {
      symbol,
      name: h.name ?? symbol.replace(/\.(NS|BO)$/, ''),
      currency: h.currency,
      quantity: new Decimal(0),
      cost: new Decimal(0),
      lastPrice: null,
    };
    entry.quantity = entry.quantity.plus(h.quantity);
    entry.cost = entry.cost.plus(h.quantity.times(h.averagePrice));
    entry.lastPrice = h.lastPrice ?? entry.lastPrice;
    matched.set(symbol, entry);
  }
  return { matched: [...matched.values()], unmatched };
}

/** Stores any instrument not seen before. Existing ones keep their name and class. */
async function upsertInstruments(tx: Tx, matched: Matched[]): Promise<Map<string, string>> {
  if (matched.length === 0) return new Map();
  const rows = await tx
    .insert(instruments)
    .values(
      matched.map((m) => ({
        symbol: m.symbol,
        name: m.name,
        assetClass: assetClassOf(m.symbol),
        currency: m.currency,
      })),
    )
    .onConflictDoUpdate({ target: instruments.symbol, set: { symbol: sql`excluded.symbol` } })
    .returning({ id: instruments.id, symbol: instruments.symbol });
  return new Map(rows.map((r) => [r.symbol, r.id]));
}

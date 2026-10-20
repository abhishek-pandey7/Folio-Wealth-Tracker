// The API on Workers: the same routes, contracts and status codes as the NestJS
// API, over the same core services. Only the wiring differs: Hono instead of
// Nest's container, and market data from Postgres instead of the Go gateway.

import {
  AccountsService,
  AppError,
  BadRequestError,
  CurrentUserService,
  consoleLogger,
  type Database,
  GoalsService,
  InstrumentsService,
  SipsService,
  TransactionsService,
  UnauthorizedError,
  ValuationService,
  WatchlistService,
} from '@folio/core';
import {
  CreateAccountSchema,
  CreateGoalSchema,
  CreateSipSchema,
  CreateTransactionSchema,
  type HealthStatus,
  SetGoalHoldingsSchema,
  StarRequestSchema,
  UpdateAccountSchema,
  UpdateGoalSchema,
  UpdateSipSchema,
} from '@folio/shared';
import { type Context, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import { authenticate, signIn, signOut } from './auth.js';
import { connect } from './db.js';
import { DEMO_EMAIL } from './demo.js';
import type { Env } from './env.js';
import type { Defer } from './market/cache.js';
import { EdgeMarket } from './market/edge.js';
import { splitList } from './market/screen.js';

function services(db: Database, market: EdgeMarket, email: string) {
  const instruments = new InstrumentsService(db, market);
  const accounts = new AccountsService(db);
  const valuation = new ValuationService(db, market, consoleLogger);
  return {
    currentUser: new CurrentUserService(db, email),
    accounts,
    transactions: new TransactionsService(db, accounts, instruments),
    valuation,
    sips: new SipsService(db, instruments, market, consoleLogger),
    goals: new GoalsService(db, valuation),
    watchlist: new WatchlistService(db, instruments),
  };
}

type Vars = { db: Database; market: EdgeMarket; svc: ReturnType<typeof services>; mode: 'owner' | 'demo' };
type Ctx = Context<{ Bindings: Env; Variables: Vars }>;

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

/** Nest's error shape, so the web app handles both deployments alike. */
const errorBody = (status: number, message: string) => ({ statusCode: status, message, error: STATUS_TEXT[status] });

async function body<S extends z.ZodType>(c: Ctx, schema: S): Promise<z.infer<S>> {
  const text = await c.req.text();
  let raw: unknown = {};
  if (text) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new BadRequestError('Request body must be JSON');
    }
  }
  // Requests without a body count as an empty object, as in the Nest API.
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) throw new BadRequestError(z.prettifyError(parsed.error));
  return parsed.data;
}

const Uuid = z.uuid();
function uuid(value: string | undefined): string {
  if (!value || !Uuid.safeParse(value).success) throw new BadRequestError('Validation failed (uuid is expected)');
  return value;
}

const accountFilter = (c: Ctx) => {
  const id = c.req.query('accountId');
  return id === undefined ? undefined : uuid(id);
};

const userId = (c: Ctx) => c.var.svc.currentUser.id();

export const app = new Hono<{ Bindings: Env; Variables: Vars }>().basePath('/api');

// Signing in and out need no database, so they come before the middleware below.

app.post('/session', async (c) => {
  const { key } = await c.req.json<{ key?: unknown }>().catch(() => ({ key: undefined }));
  c.header('set-cookie', await signIn(key, c.env));
  return c.body(null, 204);
});

app.delete('/session', (c) => {
  c.header('set-cookie', signOut());
  return c.body(null, 204);
});

app.use('*', async (c, next) => {
  // Without a valid session the visitor is the public demo user, never the owner.
  const email = await authenticate(c.req.raw, c.env).catch((error: unknown) => {
    if (error instanceof UnauthorizedError) return DEMO_EMAIL;
    throw error;
  });
  c.set('mode', email === DEMO_EMAIL ? 'demo' : 'owner');
  const deferred: Promise<unknown>[] = [];
  const defer: Defer = (work) => {
    deferred.push(work);
  };
  const { db, close } = await connect(c.env.HYPERDRIVE.connectionString);
  const market = new EdgeMarket(db, defer);
  c.set('db', db);
  c.set('market', market);
  c.set('svc', services(db, market, email));
  try {
    await next();
  } finally {
    // Background refreshes the request started still need the connection.
    c.executionCtx.waitUntil(Promise.allSettled(deferred).then(close));
  }
});

app.onError((error, c) => {
  if (error instanceof AppError) {
    return c.json(errorBody(error.status, error.message), error.status as ContentfulStatusCode);
  }
  console.error(`${c.req.method} ${c.req.path} failed:`, error);
  return c.json(errorBody(500, 'Internal server error'), 500);
});

app.notFound((c) => c.json(errorBody(404, `Cannot ${c.req.method} ${c.req.path}`), 404));

/** Whether this browser is signed in as the owner or browsing the public demo. */
app.get('/session', (c) => c.json({ mode: c.var.mode }));

app.get('/health', async (c) => {
  const database = await c.var.db.execute('select 1').then(
    () => 'up' as const,
    () => 'down' as const,
  );
  // "marketGateway" keeps the contract's name: here it means the quote job has run in the last two hours.
  const recent = await c.var.db
    .execute(`select 1 from symbol_data where quote_at > now() - interval '2 hours' limit 1`)
    .then(
      (r) => r.rows.length > 0,
      () => false,
    );
  const marketGateway = recent ? ('up' as const) : ('down' as const);
  return c.json({
    status: database === 'up' && marketGateway === 'up' ? 'ok' : 'degraded',
    database,
    marketGateway,
    timestamp: new Date().toISOString(),
  } satisfies HealthStatus);
});

// Accounts, transactions, portfolio.

app.get('/accounts', async (c) => c.json(await c.var.svc.accounts.list(await userId(c))));
app.post('/accounts', async (c) =>
  c.json(await c.var.svc.accounts.create(await userId(c), await body(c, CreateAccountSchema)), 201),
);
app.patch('/accounts/:id', async (c) =>
  c.json(await c.var.svc.accounts.update(await userId(c), uuid(c.req.param('id')), await body(c, UpdateAccountSchema))),
);
app.delete('/accounts/:id', async (c) => {
  await c.var.svc.accounts.remove(await userId(c), uuid(c.req.param('id')));
  return c.body(null, 204);
});

app.get('/transactions', async (c) => {
  const id = await userId(c);
  const accountId = accountFilter(c);
  await c.var.svc.sips.catchUp(id);
  return c.json(await c.var.svc.transactions.list(id, accountId));
});
app.post('/transactions', async (c) =>
  c.json(await c.var.svc.transactions.create(await userId(c), await body(c, CreateTransactionSchema)), 201),
);
app.delete('/transactions/:id', async (c) => {
  await c.var.svc.transactions.remove(await userId(c), uuid(c.req.param('id')));
  return c.body(null, 204);
});

app.get('/portfolio', async (c) => {
  const id = await userId(c);
  const accountId = accountFilter(c);
  // Record any SIP instalments that fell due since the last visit before valuing.
  await c.var.svc.sips.catchUp(id);
  return c.json(await c.var.svc.valuation.summary(id, accountId));
});

// SIPs and goals.

app.get('/sips', async (c) => {
  const id = await userId(c);
  await c.var.svc.sips.catchUp(id);
  return c.json(await c.var.svc.sips.list(id));
});
app.post('/sips', async (c) =>
  c.json(await c.var.svc.sips.create(await userId(c), await body(c, CreateSipSchema)), 201),
);
app.patch('/sips/:id', async (c) =>
  c.json(await c.var.svc.sips.update(await userId(c), uuid(c.req.param('id')), await body(c, UpdateSipSchema))),
);
app.delete('/sips/:id', async (c) => {
  await c.var.svc.sips.remove(await userId(c), uuid(c.req.param('id')));
  return c.body(null, 204);
});

app.get('/goals', async (c) => {
  const id = await userId(c);
  await c.var.svc.sips.catchUp(id);
  return c.json(await c.var.svc.goals.list(id));
});
app.post('/goals', async (c) =>
  c.json(await c.var.svc.goals.create(await userId(c), await body(c, CreateGoalSchema)), 201),
);
app.patch('/goals/:id', async (c) =>
  c.json(await c.var.svc.goals.update(await userId(c), uuid(c.req.param('id')), await body(c, UpdateGoalSchema))),
);
app.put('/goals/:id/holdings', async (c) =>
  c.json(
    await c.var.svc.goals.setHoldings(await userId(c), uuid(c.req.param('id')), await body(c, SetGoalHoldingsSchema)),
  ),
);
app.delete('/goals/:id', async (c) => {
  await c.var.svc.goals.remove(await userId(c), uuid(c.req.param('id')));
  return c.body(null, 204);
});

// Watchlist. PUT and DELETE are idempotent, so retries and double clicks are safe.

app.get('/watchlist', async (c) => c.json(await c.var.svc.watchlist.list(await userId(c))));
app.put('/watchlist/funds/:schemeCode', async (c) =>
  c.json(await c.var.svc.watchlist.starFund(await userId(c), c.req.param('schemeCode'))),
);
app.delete('/watchlist/funds/:schemeCode', async (c) => {
  await c.var.svc.watchlist.unstarFund(await userId(c), c.req.param('schemeCode'));
  return c.body(null, 204);
});
app.put('/watchlist/:symbol', async (c) =>
  c.json(await c.var.svc.watchlist.star(await userId(c), c.req.param('symbol'), await body(c, StarRequestSchema))),
);
app.delete('/watchlist/:symbol', async (c) => {
  await c.var.svc.watchlist.unstar(await userId(c), c.req.param('symbol'));
  return c.body(null, 204);
});

// Market data.

const screenParams = (c: Ctx) => ({
  period: c.req.query('period'),
  sort: c.req.query('sort'),
  order: c.req.query('order'),
  limit: c.req.query('limit'),
});

app.get('/market/quotes', async (c) => c.json(await c.var.market.quotes(splitList(c.req.query('symbols')))));
app.get('/market/quotes/:symbol', async (c) => c.json(await c.var.market.quote(c.req.param('symbol'))));
app.get('/market/history/:symbol', async (c) =>
  c.json(await c.var.market.history(c.req.param('symbol'), c.req.query('range'))),
);
app.get('/market/search', async (c) => c.json(await c.var.market.search(c.req.query('q') ?? '')));
app.get('/market/fx', async (c) => c.json(await c.var.market.fx(c.req.query('base'), c.req.query('quote'))));
app.get('/market/universes', (c) => c.json(c.var.market.universes()));
app.get('/market/screener', async (c) =>
  c.json(
    await c.var.market.screen({
      ...screenParams(c),
      universe: c.req.query('universe'),
      symbols: splitList(c.req.query('symbols')),
    }),
  ),
);
app.get('/market/stats/:symbol', async (c) => c.json(await c.var.market.stats(c.req.param('symbol'))));

// Literal fund routes come before funds/:schemeCode so they are not taken for scheme codes.
app.get('/market/funds/search', async (c) => c.json(await c.var.market.searchFunds(c.req.query('q') ?? '')));
app.get('/market/funds/categories', async (c) => c.json(await c.var.market.fundCategories()));
app.get('/market/funds/screener', async (c) =>
  c.json(
    await c.var.market.fundScreen({
      ...screenParams(c),
      category: c.req.query('category'),
      codes: splitList(c.req.query('codes')),
    }),
  ),
);
app.get('/market/funds/:schemeCode', async (c) => c.json(await c.var.market.fund(c.req.param('schemeCode'))));
app.get('/market/funds/:schemeCode/stats', async (c) =>
  c.json(await c.var.market.fundStats(c.req.param('schemeCode'))),
);
app.get('/market/funds/:schemeCode/history', async (c) =>
  c.json(await c.var.market.fundHistory(c.req.param('schemeCode'), c.req.query('range'))),
);

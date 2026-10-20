import { randomUUID } from 'node:crypto';
import type { Quote } from '@folio/shared';
import { NotFoundException } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '../database/database.module.js';
import * as schema from '../database/schema.js';
import type { MarketGatewayClient } from '../market/market-gateway.client.js';
import { WatchlistService } from './watchlist.service.js';

// Integration test: runs against a real, migrated Postgres when DATABASE_URL is set (CI provides one).
const databaseUrl = process.env.DATABASE_URL;

function quote(symbol: string): Quote {
  return {
    symbol,
    currency: symbol.endsWith('.NS') ? 'INR' : 'USD',
    price: '100',
    change: '1',
    changePercent: '1.01',
    previousClose: '99',
    asOf: '2026-10-19T09:59:38Z',
    source: 'test',
    stale: false,
  };
}

describe.skipIf(!databaseUrl)('WatchlistService (Postgres)', () => {
  let pool: Pool;
  let db: Database;
  let service: WatchlistService;
  const gatewayGet = vi.fn(async (path: string) => {
    const symbol = decodeURIComponent(path.split('/').at(-1) ?? '');
    if (symbol === 'NOPE.NS') {
      throw new NotFoundException('not found');
    }
    return quote(symbol);
  });
  // Unique per run so tests never collide with real data or each other.
  const run = randomUUID().slice(0, 8);
  const sym = (base: string) => `T${run}${base}`.toUpperCase().slice(0, 18);
  const userIds: string[] = [];

  async function createUser(): Promise<string> {
    const [user] = await db
      .insert(schema.users)
      .values({ email: `test-${randomUUID()}@folio.test`, displayName: 'Test' })
      .returning({ id: schema.users.id });
    if (!user) throw new Error('user insert failed');
    userIds.push(user.id);
    return user.id;
  }

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl });
    db = drizzle({ client: pool, schema });
    service = new WatchlistService(db, { get: gatewayGet } as unknown as MarketGatewayClient);
  });

  afterAll(async () => {
    if (userIds.length) {
      await db.delete(schema.users).where(inArray(schema.users.id, userIds));
    }
    await db.delete(schema.instruments).where(
      inArray(
        schema.instruments.symbol,
        ['A', 'B', 'C'].map((s) => sym(s)),
      ),
    );
    await pool.end();
  });

  it('stars a symbol, storing the gateway currency rather than anything from the client', async () => {
    const userId = await createUser();

    const item = await service.star(userId, sym('A').toLowerCase(), { name: 'Alpha Ltd', type: 'etf' });

    expect(item).toMatchObject({ symbol: sym('A'), name: 'Alpha Ltd', assetClass: 'etf', currency: 'USD' });
    expect(await service.list(userId)).toHaveLength(1);
  });

  it('is idempotent and keeps starring order', async () => {
    const userId = await createUser();

    await service.star(userId, sym('B'), {});
    await service.star(userId, sym('C'), {});
    await service.star(userId, sym('B'), {});

    expect((await service.list(userId)).map((i) => i.symbol)).toEqual([sym('B'), sym('C')]);
  });

  it('does not overwrite a known name when starred again without one', async () => {
    const userId = await createUser();
    await service.star(userId, sym('A'), { name: 'Alpha Ltd' });

    const again = await service.star(userId, sym('A'), {});

    expect(again.name).toBe('Alpha Ltd');
  });

  it('unstars idempotently', async () => {
    const userId = await createUser();
    await service.star(userId, sym('C'), {});

    await service.unstar(userId, sym('C'));
    await service.unstar(userId, sym('C'));

    expect(await service.list(userId)).toEqual([]);
  });

  it("keeps each user's stars separate", async () => {
    const alice = await createUser();
    const bob = await createUser();
    await service.star(alice, sym('A'), {});

    expect(await service.list(bob)).toEqual([]);
    await service.unstar(bob, sym('A'));
    expect(await service.list(alice)).toHaveLength(1);
  });

  it('rejects symbols the gateway cannot price, without writing anything', async () => {
    const userId = await createUser();

    await expect(service.star(userId, 'NOPE.NS', {})).rejects.toBeInstanceOf(NotFoundException);
    const rows = await db.select().from(schema.instruments).where(eq(schema.instruments.symbol, 'NOPE.NS'));
    expect(rows).toEqual([]);
  });
});

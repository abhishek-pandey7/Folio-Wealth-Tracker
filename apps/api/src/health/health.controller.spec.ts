import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { PG_POOL } from '../database/database.module.js';
import { HealthController } from './health.controller.js';

async function controllerWithPool(query: () => Promise<unknown>) {
  // Resolved through Nest's DI container, so this also proves decorator metadata survives the test transform.
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [{ provide: PG_POOL, useValue: { query: vi.fn(query) } }],
  }).compile();
  return moduleRef.get(HealthController);
}

describe('HealthController', () => {
  it('reports ok when the database answers', async () => {
    const controller = await controllerWithPool(() => Promise.resolve({ rows: [] }));

    await expect(controller.check()).resolves.toMatchObject({ status: 'ok', database: 'up' });
  });

  it('reports degraded instead of failing when the database is down', async () => {
    const controller = await controllerWithPool(() => Promise.reject(new Error('ECONNREFUSED')));

    await expect(controller.check()).resolves.toMatchObject({ status: 'degraded', database: 'down' });
  });
});

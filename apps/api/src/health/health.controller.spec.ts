import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { PG_POOL } from '../database/database.module.js';
import { MarketGatewayClient } from '../market/market-gateway.client.js';
import { HealthController } from './health.controller.js';

async function controllerWith(options: { dbUp: boolean; gatewayUp: boolean }) {
  // Resolved through Nest's DI container, so this also proves decorator metadata survives the test transform.
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      {
        provide: PG_POOL,
        useValue: {
          query: vi.fn(() => (options.dbUp ? Promise.resolve({}) : Promise.reject(new Error('ECONNREFUSED')))),
        },
      },
      { provide: MarketGatewayClient, useValue: { isUp: vi.fn(async () => options.gatewayUp) } },
    ],
  }).compile();
  return moduleRef.get(HealthController);
}

describe('HealthController', () => {
  it('reports ok when every dependency is up', async () => {
    const controller = await controllerWith({ dbUp: true, gatewayUp: true });

    await expect(controller.check()).resolves.toMatchObject({ status: 'ok', database: 'up', marketGateway: 'up' });
  });

  it('reports degraded instead of failing when the database is down', async () => {
    const controller = await controllerWith({ dbUp: false, gatewayUp: true });

    await expect(controller.check()).resolves.toMatchObject({ status: 'degraded', database: 'down' });
  });

  it('reports degraded when the market gateway is down', async () => {
    const controller = await controllerWith({ dbUp: true, gatewayUp: false });

    await expect(controller.check()).resolves.toMatchObject({ status: 'degraded', marketGateway: 'down' });
  });
});

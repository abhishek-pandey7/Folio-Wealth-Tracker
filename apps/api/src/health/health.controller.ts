import type { HealthStatus } from '@folio/shared';
import { Controller, Get, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module.js';
import { MarketGatewayClient } from '../market/market-gateway.client.js';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly gateway: MarketGatewayClient,
  ) {}

  @Get()
  async check(): Promise<HealthStatus> {
    const [database, marketGateway] = await Promise.all([
      this.pool.query('select 1').then(
        () => 'up' as const,
        () => 'down' as const,
      ),
      this.gateway.isUp().then((up) => (up ? ('up' as const) : ('down' as const))),
    ]);

    return {
      status: database === 'up' && marketGateway === 'up' ? 'ok' : 'degraded',
      database,
      marketGateway,
      timestamp: new Date().toISOString(),
    };
  }
}

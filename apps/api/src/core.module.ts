import {
  AccountsService,
  CurrentUserService,
  type Database,
  GoalsService,
  InstrumentsService,
  type Logger,
  SipsService,
  TransactionsService,
  ValuationService,
  WatchlistService,
} from '@folio/core';
import { Global, Module, Logger as NestLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './config/env.js';
import { DRIZZLE } from './database/database.module.js';
import { GatewayMarketData } from './market/gateway-market.js';
import { MarketModule } from './market/market.module.js';
import { MarketGatewayClient } from './market/market-gateway.client.js';

const logger = (context: string): Logger => {
  const nest = new NestLogger(context);
  return { warn: (message) => nest.warn(message) };
};

/**
 * Wires the framework-free core (packages/core) into Nest's container. The
 * same classes run on Cloudflare Workers with a different MarketData.
 */
@Global()
@Module({
  imports: [MarketModule],
  providers: [
    {
      provide: GatewayMarketData,
      inject: [MarketGatewayClient],
      useFactory: (c: MarketGatewayClient) => new GatewayMarketData(c),
    },
    {
      provide: CurrentUserService,
      inject: [DRIZZLE, ConfigService],
      useFactory: (db: Database, config: ConfigService<Env, true>) =>
        new CurrentUserService(db, config.get('OWNER_EMAIL', { infer: true })),
    },
    {
      provide: InstrumentsService,
      inject: [DRIZZLE, GatewayMarketData],
      useFactory: (db: Database, market: GatewayMarketData) => new InstrumentsService(db, market),
    },
    { provide: AccountsService, inject: [DRIZZLE], useFactory: (db: Database) => new AccountsService(db) },
    {
      provide: TransactionsService,
      inject: [DRIZZLE, AccountsService, InstrumentsService],
      useFactory: (db: Database, accounts: AccountsService, instruments: InstrumentsService) =>
        new TransactionsService(db, accounts, instruments),
    },
    {
      provide: ValuationService,
      inject: [DRIZZLE, GatewayMarketData],
      useFactory: (db: Database, market: GatewayMarketData) =>
        new ValuationService(db, market, logger(ValuationService.name)),
    },
    {
      provide: SipsService,
      inject: [DRIZZLE, InstrumentsService, GatewayMarketData],
      useFactory: (db: Database, instruments: InstrumentsService, market: GatewayMarketData) =>
        new SipsService(db, instruments, market, logger(SipsService.name)),
    },
    {
      provide: GoalsService,
      inject: [DRIZZLE, ValuationService],
      useFactory: (db: Database, valuation: ValuationService) => new GoalsService(db, valuation),
    },
    {
      provide: WatchlistService,
      inject: [DRIZZLE, InstrumentsService],
      useFactory: (db: Database, instruments: InstrumentsService) => new WatchlistService(db, instruments),
    },
  ],
  exports: [
    CurrentUserService,
    InstrumentsService,
    AccountsService,
    TransactionsService,
    ValuationService,
    SipsService,
    GoalsService,
    WatchlistService,
  ],
})
export class CoreModule {}

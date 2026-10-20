import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { AppErrorFilter } from './common/app-error.filter.js';
import { validateEnv } from './config/env.js';
import { CoreModule } from './core.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { MarketModule } from './market/market.module.js';
import { PlanModule } from './plan/plan.module.js';
import { PortfolioModule } from './portfolio/portfolio.module.js';
import { WatchlistModule } from './watchlist/watchlist.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Scripts run from apps/api, but the .env lives at the repo root.
      envFilePath: ['../../.env', '.env'],
      validate: validateEnv,
    }),
    DatabaseModule,
    CoreModule,
    MarketModule,
    WatchlistModule,
    PortfolioModule,
    PlanModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: AppErrorFilter }],
})
export class AppModule {}

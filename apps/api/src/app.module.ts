import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { MarketModule } from './market/market.module.js';
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
    MarketModule,
    WatchlistModule,
    PortfolioModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

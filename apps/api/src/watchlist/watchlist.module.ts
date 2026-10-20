import { Module } from '@nestjs/common';
import { MarketModule } from '../market/market.module.js';
import { UsersModule } from '../users/users.module.js';
import { WatchlistController } from './watchlist.controller.js';
import { WatchlistService } from './watchlist.service.js';

@Module({
  imports: [MarketModule, UsersModule],
  controllers: [WatchlistController],
  providers: [WatchlistService],
})
export class WatchlistModule {}

import { Module } from '@nestjs/common';
import { WatchlistController } from './watchlist.controller.js';

@Module({
  controllers: [WatchlistController],
})
export class WatchlistModule {}

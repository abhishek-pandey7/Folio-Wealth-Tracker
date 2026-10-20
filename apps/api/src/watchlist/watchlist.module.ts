import { Module } from '@nestjs/common';
import { InstrumentsModule } from '../instruments/instruments.module.js';
import { UsersModule } from '../users/users.module.js';
import { WatchlistController } from './watchlist.controller.js';
import { WatchlistService } from './watchlist.service.js';

@Module({
  imports: [InstrumentsModule, UsersModule],
  controllers: [WatchlistController],
  providers: [WatchlistService],
})
export class WatchlistModule {}

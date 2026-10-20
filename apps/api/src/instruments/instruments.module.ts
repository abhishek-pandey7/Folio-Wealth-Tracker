import { Module } from '@nestjs/common';
import { MarketModule } from '../market/market.module.js';
import { InstrumentsService } from './instruments.service.js';

@Module({
  imports: [MarketModule],
  providers: [InstrumentsService],
  exports: [InstrumentsService],
})
export class InstrumentsModule {}

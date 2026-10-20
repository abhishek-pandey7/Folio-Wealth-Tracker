import { Module } from '@nestjs/common';
import { InstrumentsModule } from '../instruments/instruments.module.js';
import { MarketModule } from '../market/market.module.js';
import { SipsService } from './sips.service.js';

/** SIP recording, separate from goals so the portfolio can trigger catch-up without a dependency cycle. */
@Module({
  imports: [InstrumentsModule, MarketModule],
  providers: [SipsService],
  exports: [SipsService],
})
export class SipsModule {}

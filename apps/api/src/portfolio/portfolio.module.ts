import { Module } from '@nestjs/common';
import { InstrumentsModule } from '../instruments/instruments.module.js';
import { MarketModule } from '../market/market.module.js';
import { UsersModule } from '../users/users.module.js';
import { AccountsService } from './accounts.service.js';
import { AccountsController, PortfolioController, TransactionsController } from './portfolio.controller.js';
import { TransactionsService } from './transactions.service.js';
import { ValuationService } from './valuation.service.js';

@Module({
  imports: [InstrumentsModule, MarketModule, UsersModule],
  controllers: [AccountsController, TransactionsController, PortfolioController],
  providers: [AccountsService, TransactionsService, ValuationService],
})
export class PortfolioModule {}

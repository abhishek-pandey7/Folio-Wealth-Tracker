import { Module } from '@nestjs/common';
import { AccountsController, PortfolioController, TransactionsController } from './portfolio.controller.js';

@Module({
  controllers: [AccountsController, TransactionsController, PortfolioController],
})
export class PortfolioModule {}

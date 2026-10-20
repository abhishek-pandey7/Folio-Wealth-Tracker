import { Module } from '@nestjs/common';
import { PortfolioModule } from '../portfolio/portfolio.module.js';
import { UsersModule } from '../users/users.module.js';
import { GoalsService } from './goals.service.js';
import { CronController, GoalsController, SipsController } from './plan.controller.js';
import { SipsModule } from './sips.module.js';

@Module({
  imports: [SipsModule, PortfolioModule, UsersModule],
  controllers: [SipsController, GoalsController, CronController],
  providers: [GoalsService],
})
export class PlanModule {}

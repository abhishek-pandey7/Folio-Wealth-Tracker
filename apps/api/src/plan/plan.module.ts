import { Module } from '@nestjs/common';
import { CronController, GoalsController, SipsController } from './plan.controller.js';

@Module({
  controllers: [SipsController, GoalsController, CronController],
})
export class PlanModule {}

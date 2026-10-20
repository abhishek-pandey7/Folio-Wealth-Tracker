import { timingSafeEqual } from 'node:crypto';
import {
  type CreateGoal,
  CreateGoalSchema,
  type CreateSip,
  CreateSipSchema,
  type Goal,
  type SetGoalHoldings,
  SetGoalHoldingsSchema,
  type Sip,
  type UpdateGoal,
  UpdateGoalSchema,
  type UpdateSip,
  UpdateSipSchema,
} from '@folio/shared';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { Env } from '../config/env.js';
import { CurrentUserService } from '../users/current-user.service.js';
import { GoalsService } from './goals.service.js';
import { SipsService } from './sips.service.js';

@Controller('sips')
export class SipsController {
  constructor(
    private readonly sips: SipsService,
    private readonly currentUser: CurrentUserService,
  ) {}

  @Get()
  async list(): Promise<Sip[]> {
    const userId = await this.currentUser.id();
    await this.sips.catchUp(userId);
    return this.sips.list(userId);
  }

  @Post()
  async create(@Body(new ZodValidationPipe(CreateSipSchema)) body: CreateSip): Promise<Sip> {
    return this.sips.create(await this.currentUser.id(), body);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateSipSchema)) body: UpdateSip,
  ): Promise<Sip> {
    return this.sips.update(await this.currentUser.id(), id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.sips.remove(await this.currentUser.id(), id);
  }
}

/**
 * Called by a scheduler (a Cloudflare Cron Trigger in production) to record
 * due SIP instalments even when nobody opens the app. Disabled unless
 * CRON_SECRET is set, and the caller must present it.
 */
@Controller('internal')
export class CronController {
  private readonly secret: string | undefined;

  constructor(
    private readonly sips: SipsService,
    config: ConfigService<Env, true>,
  ) {
    this.secret = config.get('CRON_SECRET', { infer: true });
  }

  @Post('sips/run')
  async run(@Headers('x-cron-secret') presented?: string): Promise<{ users: number; recorded: number }> {
    if (!this.secret || !presented || !safeEqual(presented, this.secret)) {
      throw new ForbiddenException();
    }
    return this.sips.runAll();
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

@Controller('goals')
export class GoalsController {
  constructor(
    private readonly goals: GoalsService,
    private readonly sips: SipsService,
    private readonly currentUser: CurrentUserService,
  ) {}

  @Get()
  async list(): Promise<Goal[]> {
    const userId = await this.currentUser.id();
    await this.sips.catchUp(userId);
    return this.goals.list(userId);
  }

  @Post()
  async create(@Body(new ZodValidationPipe(CreateGoalSchema)) body: CreateGoal): Promise<Goal> {
    return this.goals.create(await this.currentUser.id(), body);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateGoalSchema)) body: UpdateGoal,
  ): Promise<Goal> {
    return this.goals.update(await this.currentUser.id(), id, body);
  }

  @Put(':id/holdings')
  async setHoldings(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(SetGoalHoldingsSchema)) body: SetGoalHoldings,
  ): Promise<Goal> {
    return this.goals.setHoldings(await this.currentUser.id(), id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.goals.remove(await this.currentUser.id(), id);
  }
}

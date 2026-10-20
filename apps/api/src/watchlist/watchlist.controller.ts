import { type StarRequest, StarRequestSchema, type WatchlistItem } from '@folio/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Put } from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CurrentUserService } from '../users/current-user.service.js';
import { WatchlistService } from './watchlist.service.js';

/** Starred symbols. PUT and DELETE are idempotent, so retries and double clicks are safe. */
@Controller('watchlist')
export class WatchlistController {
  constructor(
    private readonly watchlist: WatchlistService,
    private readonly currentUser: CurrentUserService,
  ) {}

  @Get()
  async list(): Promise<WatchlistItem[]> {
    return this.watchlist.list(await this.currentUser.id());
  }

  @Put(':symbol')
  async star(
    @Param('symbol') symbol: string,
    @Body(new ZodValidationPipe(StarRequestSchema)) body: StarRequest,
  ): Promise<WatchlistItem> {
    return this.watchlist.star(await this.currentUser.id(), symbol, body);
  }

  @Delete(':symbol')
  @HttpCode(204)
  async unstar(@Param('symbol') symbol: string): Promise<void> {
    await this.watchlist.unstar(await this.currentUser.id(), symbol);
  }
}

import { type StarRequest, StarRequestSchema, type WatchlistItem } from '@folio/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Put } from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CurrentUserService } from '../users/current-user.service.js';
import { WatchlistService } from './watchlist.service.js';

/** Starred stocks, ETFs, indices and mutual funds. PUT and DELETE are idempotent, so retries and double clicks are safe. */
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

  @Put('funds/:schemeCode')
  async starFund(@Param('schemeCode') schemeCode: string): Promise<WatchlistItem> {
    return this.watchlist.starFund(await this.currentUser.id(), schemeCode);
  }

  @Delete('funds/:schemeCode')
  @HttpCode(204)
  async unstarFund(@Param('schemeCode') schemeCode: string): Promise<void> {
    await this.watchlist.unstarFund(await this.currentUser.id(), schemeCode);
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

import {
  type Account,
  type CreateAccount,
  CreateAccountSchema,
  type CreateTransaction,
  CreateTransactionSchema,
  type PortfolioSummary,
  type Transaction,
  type UpdateAccount,
  UpdateAccountSchema,
} from '@folio/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SipsService } from '../plan/sips.service.js';
import { CurrentUserService } from '../users/current-user.service.js';
import { AccountsService } from './accounts.service.js';
import { TransactionsService } from './transactions.service.js';
import { ValuationService } from './valuation.service.js';

const AccountFilterSchema = z.object({ accountId: z.uuid().optional() });
type AccountFilter = z.infer<typeof AccountFilterSchema>;

@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly currentUser: CurrentUserService,
  ) {}

  @Get()
  async list(): Promise<Account[]> {
    return this.accounts.list(await this.currentUser.id());
  }

  @Post()
  async create(@Body(new ZodValidationPipe(CreateAccountSchema)) body: CreateAccount): Promise<Account> {
    return this.accounts.create(await this.currentUser.id(), body);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateAccountSchema)) body: UpdateAccount,
  ): Promise<Account> {
    return this.accounts.update(await this.currentUser.id(), id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.accounts.remove(await this.currentUser.id(), id);
  }
}

@Controller('transactions')
export class TransactionsController {
  constructor(
    private readonly transactions: TransactionsService,
    private readonly sips: SipsService,
    private readonly currentUser: CurrentUserService,
  ) {}

  @Get()
  async list(@Query(new ZodValidationPipe(AccountFilterSchema)) query: AccountFilter): Promise<Transaction[]> {
    const userId = await this.currentUser.id();
    await this.sips.catchUp(userId);
    return this.transactions.list(userId, query.accountId);
  }

  @Post()
  async create(@Body(new ZodValidationPipe(CreateTransactionSchema)) body: CreateTransaction): Promise<Transaction> {
    return this.transactions.create(await this.currentUser.id(), body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.transactions.remove(await this.currentUser.id(), id);
  }
}

@Controller('portfolio')
export class PortfolioController {
  constructor(
    private readonly valuation: ValuationService,
    private readonly sips: SipsService,
    private readonly currentUser: CurrentUserService,
  ) {}

  @Get()
  async summary(@Query(new ZodValidationPipe(AccountFilterSchema)) query: AccountFilter): Promise<PortfolioSummary> {
    const userId = await this.currentUser.id();
    // Record any SIP instalments that fell due since the last visit before valuing.
    await this.sips.catchUp(userId);
    return this.valuation.summary(userId, query.accountId);
  }
}

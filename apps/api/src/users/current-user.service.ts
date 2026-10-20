import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { type Database, DRIZZLE } from '../database/database.module.js';
import { users } from '../database/schema.js';

/**
 * Single-owner mode until authentication lands: every request acts as the
 * owner configured by OWNER_EMAIL. All data access is already scoped by user
 * id, so adding OIDC later only changes how that id is resolved here.
 */
@Injectable()
export class CurrentUserService {
  private readonly email: string;
  private ownerId: Promise<string> | undefined;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    config: ConfigService<Env, true>,
  ) {
    this.email = config.get('OWNER_EMAIL', { infer: true });
  }

  id(): Promise<string> {
    this.ownerId ??= this.ensureOwner().catch((error: unknown) => {
      this.ownerId = undefined; // retry on the next request instead of caching the failure
      throw error;
    });
    return this.ownerId;
  }

  private async ensureOwner(): Promise<string> {
    const [owner] = await this.db
      .insert(users)
      .values({ email: this.email, displayName: 'Owner' })
      .onConflictDoUpdate({ target: users.email, set: { email: this.email } })
      .returning({ id: users.id });
    if (!owner) {
      throw new Error('Could not create or load the owner user');
    }
    return owner.id;
  }
}

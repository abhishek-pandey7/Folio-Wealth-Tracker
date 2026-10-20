import type { Database } from './database.js';
import { users } from './schema.js';

/**
 * Single-owner mode until authentication lands: every request acts as the
 * owner with this email. All data access is already scoped by user id, so
 * adding real sign-in later only changes how that id is resolved here.
 */
export class CurrentUserService {
  private ownerId: Promise<string> | undefined;

  constructor(
    private readonly db: Database,
    private readonly email: string,
  ) {}

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

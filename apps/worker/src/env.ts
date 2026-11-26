export interface Env {
  /** Pooled connection to Postgres (Neon) through Hyperdrive. */
  HYPERDRIVE: Hyperdrive;
  /** The web app's build, served for every path that is not /api. */
  ASSETS: Fetcher;
  /** The single user of this deployment. */
  OWNER_EMAIL: string;
  /** The secret in the owner's sign-in link (#key=…); see auth.ts. At least 32 characters. */
  LOGIN_KEY?: string;
  /** "true" skips sign-in. Only for local `wrangler pages dev`, set in .dev.vars. */
  ALLOW_UNAUTHENTICATED?: string;

  // Read-only broker sync (docs/BROKERS.md). A broker is offered once its keys are set.
  /** Encrypts stored broker sessions. Defaults to LOGIN_KEY; set it to rotate the two separately. */
  BROKER_TOKEN_KEY?: string;
  DHAN_CLIENT_ID?: string;
  DHAN_API_KEY?: string;
  DHAN_API_SECRET?: string;
  KITE_API_KEY?: string;
  KITE_API_SECRET?: string;
  UPSTOX_API_KEY?: string;
  UPSTOX_API_SECRET?: string;
  ANGELONE_API_KEY?: string;
  /** INDmoney needs no keys (Folio registers itself over OAuth); "true" offers it. */
  INDMONEY_ENABLED?: string;
}

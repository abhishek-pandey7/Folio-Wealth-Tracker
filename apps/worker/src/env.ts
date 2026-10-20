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
}

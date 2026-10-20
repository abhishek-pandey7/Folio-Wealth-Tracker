export interface Env {
  /** Pooled connection to Postgres (Neon) through Hyperdrive. */
  HYPERDRIVE: Hyperdrive;
  /** The web app's build, served for every path that is not /api. */
  ASSETS: Fetcher;
  /** The single user of this deployment. */
  OWNER_EMAIL: string;
  /** Cloudflare Access team domain, e.g. https://folio.cloudflareaccess.com */
  ACCESS_TEAM_DOMAIN?: string;
  /** The Access application's audience tag. */
  ACCESS_AUD?: string;
  /** "true" skips the Access check. Only for `wrangler dev`, set in .dev.vars. */
  ALLOW_UNAUTHENTICATED?: string;
}

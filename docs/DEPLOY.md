# Deploying to Cloudflare (free plan)

One Worker serves the web app, the API and the scheduled market data jobs. Postgres runs on Neon's free tier, reached through Hyperdrive. Cloudflare Access lets only the owner in. Why it is built this way: [ARCHITECTURE.md, section 4.9](ARCHITECTURE.md#49-production-on-cloudflares-free-plan).

Nothing here needs a paid plan.

## 1. Database (Neon)

1. Create a project at [neon.tech](https://neon.tech), in the region closest to you (Singapore for India).
2. Copy the connection string (`postgresql://…/neondb?sslmode=require`). It is a secret: keep it out of the repo and out of chat logs.
3. Create the tables:

   ```bash
   DATABASE_URL='postgresql://…' npm run db:migrate
   ```

## 2. Hyperdrive

```bash
cd apps/worker
npx wrangler login
npx wrangler hyperdrive create folio-db --connection-string='postgresql://…' --caching-disabled
```

Put the printed `id` in `wrangler.jsonc` in place of `REPLACE_WITH_HYPERDRIVE_ID`. Keep `--caching-disabled`: Hyperdrive's query cache would show data up to a minute old right after you add a transaction.

## 3. Deploy

```bash
npx wrangler secret put OWNER_EMAIL       # the email you will sign in with
npm run deploy -w @folio/worker            # builds the web app, then deploys
```

The site answers at `https://folio.<your-subdomain>.workers.dev`. Every API call returns 403 until Access is set up, which is intended: the Worker refuses to serve data without it.

## 4. Cloudflare Access

1. In the dashboard: **Workers & Pages → folio → Settings → Domains & Routes**, and enable **Cloudflare Access** on the `workers.dev` route. This creates an Access application for the hostname.
2. In **Zero Trust → Access → Applications**, open it and set the policy to **Allow**, with **Include → Emails →** your email only.
3. From the application's overview, copy the **Application Audience (AUD) tag**. Your team domain is `https://<team-name>.cloudflareaccess.com`, with the team name shown in the Zero Trust settings.
4. Give both to the Worker:

   ```bash
   npx wrangler secret put ACCESS_TEAM_DOMAIN   # https://<team>.cloudflareaccess.com
   npx wrangler secret put ACCESS_AUD
   ```

Open the site: Access asks for your email and sends a one-time code. Then the app loads.

## 5. First data

The cron trigger runs every minute. From an empty database, all 141 curated symbols and the fund catalogue load within about an hour, and every fund's statistics within about two. Anything you open before then loads on demand, a few instruments per request.

Watch the jobs:

```bash
npx wrangler tail          # each run logs {"job": ..., "refreshed": ...}
```

or query `select name, report from job_state;`.

## Local development against the Workers runtime

```bash
npm run db:up && npm run db:migrate
npm run build -w @folio/web
cd apps/worker && npx wrangler dev --test-scheduled
```

Copy `apps/worker/.dev.vars.example` to `.dev.vars` (git-ignored). It sets `OWNER_EMAIL` and `ALLOW_UNAUTHENTICATED=true`, which skips the Access check; it is never set in production. To run the scheduled handler once:

```bash
curl -X POST 'http://127.0.0.1:8787/cdn-cgi/local/explorer/api/local/scheduled?worker=folio' \
  -H 'content-type: application/json' -d '{"cron":"* * * * *"}'
```

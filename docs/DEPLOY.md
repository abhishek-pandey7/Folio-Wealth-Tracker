# Deploying to Cloudflare (free plan)

Two Cloudflare pieces share one Postgres database:

| Piece | What it runs | Address |
| --- | --- | --- |
| Pages project `folio` | The web build, and the API in `functions/api` (only `/api/*` runs code) | https://folio-4u6.pages.dev |
| Worker `folio-cron` | The scheduled market data jobs, every minute | None: `workers_dev` is off |

Pages has no cron triggers, hence the second piece. Postgres runs on Neon's free tier, reached through Hyperdrive. Cloudflare Access lets only the owner in. Why it is built this way: [ARCHITECTURE.md, section 4.9](ARCHITECTURE.md#49-production-on-cloudflares-free-plan).

Nothing here needs a paid plan. Configs: `apps/worker/wrangler.jsonc` (Pages) and `apps/worker/cron/wrangler.jsonc` (cron).

## 1. Database (Neon)

Create a project at [neon.tech](https://neon.tech), in the region closest to you (Singapore for India). Then create the tables. Fetching the connection string with Neon's CLI keeps the password out of your shell history and terminal:

```bash
npx neonctl auth
CS=$(npx neonctl connection-string --project-id <project-id> --database-name neondb --role-name neondb_owner)
DATABASE_URL="$CS" npm run db:migrate
```

## 2. Hyperdrive

```bash
npx wrangler login
npx wrangler hyperdrive create folio-db --connection-string="$CS" --caching-disabled
```

Use Neon's direct connection string, not the `-pooler` one: Hyperdrive does the pooling. Put the printed `id` in both wrangler configs. Keep `--caching-disabled`: Hyperdrive's query cache would show data up to a minute old right after you add a transaction.

## 3. Deploy

```bash
cd apps/worker
npx wrangler pages project create folio --production-branch main     # once
printf 'you@example.com' | npx wrangler pages secret put OWNER_EMAIL --project-name folio
npm run deploy -w @folio/worker    # web build, then the Pages deploy, then folio-cron
```

Every API call returns 403 until Access is set up, which is intended: the API refuses to serve data without it. A new cron Worker can take about five minutes before its first scheduled run.

## 4. Cloudflare Access

1. **Zero Trust → Access → Applications → Add an application → Self-hosted.** Add two public hostnames: `folio-4u6.pages.dev` and `*.folio-4u6.pages.dev` (every deployment also gets a preview address like `b877ce81.folio-4u6.pages.dev`).
2. Add a policy: **Allow**, **Include → Emails →** the owner email only. Leave the login method as one-time PIN.
3. Save, open the application, and copy its **Application Audience (AUD) tag**. The team domain is `https://<team-name>.cloudflareaccess.com`, with the team name shown in the Zero Trust settings.
4. Give both to the API and redeploy, since Pages secrets apply to new deployments:

   ```bash
   printf 'https://<team-name>.cloudflareaccess.com' | npx wrangler pages secret put ACCESS_TEAM_DOMAIN --project-name folio
   printf '<aud-tag>' | npx wrangler pages secret put ACCESS_AUD --project-name folio
   npm run deploy -w @folio/worker
   ```

Open the site: Access asks for your email and sends a one-time code. Then the app loads.

## 5. First data

From an empty database, all 141 curated symbols and the fund catalogue load within about an hour, and every fund's statistics within about two. Anything you open before then loads on demand, a few instruments per request.

Watch the jobs with `npx wrangler tail folio-cron` (each run logs `{"job": ..., "refreshed": ...}`), or query `select name, report from job_state;`.

## Local development against the Workers runtime

```bash
npm run db:up && npm run db:migrate
npm run build -w @folio/web
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
npm run dev -w @folio/worker        # the site and API, http://127.0.0.1:8788
npm run dev:cron -w @folio/worker   # the cron Worker, http://127.0.0.1:8787
```

`.dev.vars` (git-ignored) sets `OWNER_EMAIL` and `ALLOW_UNAUTHENTICATED=true`, which skips the Access check; it is never set in production. To run the scheduled handler once:

```bash
curl -X POST 'http://127.0.0.1:8787/cdn-cgi/local/explorer/api/local/scheduled?worker=folio-cron' \
  -H 'content-type: application/json' -d '{"cron":"* * * * *"}'
```

import { consoleLogger } from '@folio/core';
import { app } from './app.js';
import { connect } from './db.js';
import type { Env } from './env.js';
import { runDue } from './jobs.js';

export default {
  // Static assets answer every path except /api/* before the Worker runs (see wrangler.jsonc).
  fetch: app.fetch,

  async scheduled(_controller, env, ctx) {
    const { db, close } = await connect(env.HYPERDRIVE.connectionString);
    const deferred: Promise<unknown>[] = [];
    try {
      const ran = await runDue(db, consoleLogger, (work) => {
        deferred.push(work);
      });
      if (ran) console.log(JSON.stringify({ job: ran.job, ...ran.report }));
    } finally {
      ctx.waitUntil(Promise.allSettled(deferred).then(close));
    }
  },
} satisfies ExportedHandler<Env>;

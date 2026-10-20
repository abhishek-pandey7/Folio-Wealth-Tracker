import { consoleLogger } from '@folio/core';
import { connect } from './db.js';
import type { Env } from './env.js';
import { runDue } from './jobs.js';

/**
 * The folio-cron Worker: scheduled jobs only, with no public URL. Pages, which
 * serves the site and the API, has no cron triggers of its own.
 */
export default {
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
} satisfies ExportedHandler<Pick<Env, 'HYPERDRIVE'>>;

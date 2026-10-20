import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './schema.js';

/** Drizzle over node-postgres: a Pool locally, a Hyperdrive connection on Workers. */
export type Database = NodePgDatabase<typeof schema>;

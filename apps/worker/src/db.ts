import { type Database, schema } from '@folio/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';

/**
 * One client per invocation. Hyperdrive keeps the real connections to Neon
 * warm and pooled near the database, so connecting here is cheap; a Pool
 * would outlive the request, which Workers do not allow.
 */
export async function connect(connectionString: string): Promise<{ db: Database; close: () => Promise<void> }> {
  const client = new Client({ connectionString });
  await client.connect();
  return { db: drizzle({ client, schema }), close: () => client.end() };
}

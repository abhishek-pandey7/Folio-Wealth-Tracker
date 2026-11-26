import {
  AngelOneAdapter,
  type BrokerAdapter,
  BrokersService,
  consoleLogger,
  type Database,
  DhanAdapter,
  IndmoneyAdapter,
  UpstoxAdapter,
  ZerodhaAdapter,
} from '@folio/core';
import type { Env } from './env.js';

/** Adapters for the brokers whose API keys this deployment has. */
export function adaptersFrom(env: Env): BrokerAdapter[] {
  const adapters: BrokerAdapter[] = [];
  if (env.DHAN_CLIENT_ID && env.DHAN_API_KEY && env.DHAN_API_SECRET) {
    adapters.push(
      new DhanAdapter({ clientId: env.DHAN_CLIENT_ID, apiKey: env.DHAN_API_KEY, apiSecret: env.DHAN_API_SECRET }),
    );
  }
  if (env.KITE_API_KEY && env.KITE_API_SECRET) {
    adapters.push(new ZerodhaAdapter({ apiKey: env.KITE_API_KEY, apiSecret: env.KITE_API_SECRET }));
  }
  if (env.UPSTOX_API_KEY && env.UPSTOX_API_SECRET) {
    adapters.push(new UpstoxAdapter({ apiKey: env.UPSTOX_API_KEY, apiSecret: env.UPSTOX_API_SECRET }));
  }
  if (env.ANGELONE_API_KEY) adapters.push(new AngelOneAdapter({ apiKey: env.ANGELONE_API_KEY }));
  if (env.INDMONEY_ENABLED === 'true') adapters.push(new IndmoneyAdapter());
  return adapters;
}

const MIN_SECRET_LENGTH = 32;

export function brokersService(db: Database, env: Env): BrokersService {
  const secret = env.BROKER_TOKEN_KEY ?? env.LOGIN_KEY ?? null;
  return new BrokersService(db, {
    adapters: adaptersFrom(env),
    secret: secret && secret.length >= MIN_SECRET_LENGTH ? secret : null,
    logger: consoleLogger,
  });
}

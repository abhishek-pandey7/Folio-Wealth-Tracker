import { z } from 'zod';

/**
 * Brokers whose holdings Folio can sync, read-only. All have a free API for
 * retail customers. The Indian brokers each need an API key set as a
 * deployment secret; INDmoney (US stocks) registers itself over OAuth.
 */
export const BROKER_IDS = ['dhan', 'zerodha', 'upstox', 'angelone', 'indmoney'] as const;
export const BrokerIdSchema = z.enum(BROKER_IDS);
export type BrokerId = z.infer<typeof BrokerIdSchema>;

export const BROKER_NAMES: Record<BrokerId, string> = {
  dhan: 'Dhan',
  zerodha: 'Zerodha',
  upstox: 'Upstox',
  angelone: 'Angel One',
  indmoney: 'INDmoney',
};

/** The currency of the account a broker's holdings sync into. */
export const BROKER_CURRENCY: Record<BrokerId, 'INR' | 'USD'> = {
  dhan: 'INR',
  zerodha: 'INR',
  upstox: 'INR',
  angelone: 'INR',
  indmoney: 'USD',
};

/**
 * How the owner logs in each day (Indian brokers expire API sessions daily):
 * "redirect" sends the browser to the broker's own login page and back;
 * "credentials" posts the client code, PIN and current TOTP code once, and
 * Folio keeps only the session token it gets back.
 */
export const BrokerLoginSchema = z.enum(['redirect', 'credentials']);
export type BrokerLogin = z.infer<typeof BrokerLoginSchema>;

export const BROKER_LOGIN: Record<BrokerId, BrokerLogin> = {
  dhan: 'redirect',
  zerodha: 'redirect',
  upstox: 'redirect',
  angelone: 'credentials',
  indmoney: 'redirect',
};

export const BrokerConnectionSchema = z.object({
  accountId: z.uuid(),
  accountName: z.string(),
  /** The name or client code the broker reported at login. */
  userName: z.string().nullable(),
  /** active: the broker session is valid, so holdings can refresh. expired: showing the last snapshot. */
  status: z.enum(['active', 'expired']),
  /** True when the broker lets Folio renew the session itself, so no daily login is needed. */
  renews: z.boolean(),
  expiresAt: z.iso.datetime().nullable(),
  syncedAt: z.iso.datetime().nullable(),
  /** Why the last sync failed, or which holdings it could not match. */
  error: z.string().nullable(),
  holdings: z.number().int(),
});
export type BrokerConnection = z.infer<typeof BrokerConnectionSchema>;

export const BrokerSchema = z.object({
  id: BrokerIdSchema,
  name: z.string(),
  login: BrokerLoginSchema,
  /** Whether this deployment has the broker's API keys. */
  configured: z.boolean(),
  connection: BrokerConnectionSchema.nullable(),
});
export type Broker = z.infer<typeof BrokerSchema>;

export const BrokersSchema = z.object({
  /** False for the public demo and for deployments without a token encryption key. */
  enabled: z.boolean(),
  brokers: z.array(BrokerSchema),
});
export type Brokers = z.infer<typeof BrokersSchema>;

/** A random value the browser keeps and checks when the broker sends it back. */
export const BrokerStartSchema = z.object({ state: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, 'Invalid state') });
/** `carry` is encrypted login state the browser keeps and hands back to complete the login. */
export const BrokerStartResultSchema = z.object({ url: z.url(), carry: z.string().nullable() });

/** What came back from the broker: query parameters of the redirect, or the credentials form. */
export const BrokerCompleteSchema = z.object({
  params: z.record(z.string().max(64), z.string().max(4096)),
  carry: z.string().max(8192).nullable().optional(),
});
export type BrokerComplete = z.infer<typeof BrokerCompleteSchema>;

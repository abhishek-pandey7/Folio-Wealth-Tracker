import { Decimal } from '@folio/shared';
import { UpstreamError } from '../errors.js';

export type Fetch = typeof fetch;

/**
 * A broker answered with an error. `sessionExpired` means the session token
 * was rejected (expired, revoked, or a master logout), so the owner has to
 * log in again; anything else is worth retrying later.
 */
export class BrokerRequestError extends UpstreamError {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly body: unknown,
    readonly sessionExpired: boolean,
  ) {
    super(message);
  }
}

interface CallOptions {
  broker: string;
  url: string;
  init?: RequestInit;
  /** Decides whether an error response means the session is gone. Defaults to HTTP 401 or 403. */
  sessionError?: (status: number, body: unknown) => boolean;
}

/** One JSON request to a broker. Never puts tokens or secrets in error messages. */
export async function call(fetchFn: Fetch, { broker, url, init, sessionError }: CallOptions): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchFn(url, init);
  } catch {
    throw new UpstreamError(`${broker} could not be reached`);
  }
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const expired = sessionError
      ? sessionError(response.status, body)
      : response.status === 401 || response.status === 403;
    const detail = messageOf(body) ?? `request failed (${response.status})`;
    throw new BrokerRequestError(`${broker}: ${detail}`, response.status, body, expired);
  }
  return body;
}

/** The human-readable message in a broker's error body, whichever field it uses. */
export function messageOf(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  const nested = b.error && typeof b.error === 'object' ? (b.error as Record<string, unknown>).message : undefined;
  const listed = Array.isArray(b.errors) ? (b.errors[0] as Record<string, unknown> | undefined)?.message : undefined;
  const found = [b.message, b.errorMessage, nested, listed].find((m) => typeof m === 'string' && m.trim());
  return typeof found === 'string' ? found.trim().slice(0, 200) : undefined;
}

export const field = (obj: unknown, key: string): unknown =>
  obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined;

export function text(obj: unknown, key: string): string | null {
  const value = field(obj, key);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** A broker number (JSON number or numeric string) as a Decimal, or null if absent or not a number. */
export function decimal(value: unknown): Decimal | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^-?\d+(\.\d+)?$/.test(value.trim())) return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return new Decimal(value);
}

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** The next time the clock in India reads hour:minute. Broker sessions end at fixed IST times. */
export function nextIstTime(hour: number, minute: number, now = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const target = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), hour, minute) - IST_OFFSET_MS;
  return new Date(target > now.getTime() ? target : target + DAY_MS);
}

/** A timestamp without a zone ("2025-01-01T09:00:00.000"), read as Indian time. */
export function istTimestamp(value: string | null): Date | null {
  if (!value) return null;
  const zoned = /([zZ]|[+-]\d\d:?\d\d)$/.test(value) ? value : `${value}+05:30`;
  const date = new Date(zoned);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The `exp` claim of a JWT, without verifying it: only used to know when to stop trying. */
export function jwtExpiry(token: string): Date | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const json = atob(
      payload
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(payload.length / 4) * 4, '='),
    );
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' && exp > 0 ? new Date(exp * 1000) : null;
  } catch {
    return null;
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

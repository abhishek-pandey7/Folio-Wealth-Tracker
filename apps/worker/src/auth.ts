// Single-owner sign-in with a secret link. The owner opens
// https://<site>/#key=<LOGIN_KEY> once per device; the web app posts the key
// here and gets a signed session cookie. The key travels in the URL fragment,
// which browsers never send to a server, so it stays out of request logs.
//
// LOGIN_KEY is 256 random bits (a Pages secret), so guessing it is not a
// practical attack and needs no rate limit. Rotating it signs every device out,
// because sessions are signed with it. Fails closed: without a key, nothing passes.

import { UnauthorizedError } from '@folio/core';
import type { Env } from './env.js';

const COOKIE = 'folio_session';
const SESSION_DAYS = 90;
const MIN_KEY_LENGTH = 32;

const encoder = new TextEncoder();

const base64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

async function sign(key: string, message: string): Promise<string> {
  const hmac = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return base64url(await crypto.subtle.sign('HMAC', hmac, encoder.encode(message)));
}

/** Compares secrets without leaking, through timing, how many leading characters matched. */
async function same(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const p = new Uint8Array(x);
  const q = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < p.length; i++) diff |= (p[i] as number) ^ (q[i] as number);
  return diff === 0;
}

function loginKey(env: Env): string {
  if (!env.LOGIN_KEY || env.LOGIN_KEY.length < MIN_KEY_LENGTH) throw new UnauthorizedError('Sign-in is not configured');
  return env.LOGIN_KEY;
}

const payload = (expires: number) => `folio-session-v1:${expires}`;

/** Checks the sign-in key and returns the Set-Cookie header for a new session. */
export async function signIn(key: unknown, env: Env, now = Date.now()): Promise<string> {
  const expected = loginKey(env);
  if (typeof key !== 'string' || !(await same(key, expected))) throw new UnauthorizedError('Invalid sign-in link');
  const expires = Math.floor(now / 1000) + SESSION_DAYS * 86_400;
  const token = `${expires}.${await sign(expected, payload(expires))}`;
  // Strict: the browser never sends it on a request started by another site, which also rules out CSRF.
  return `${COOKIE}=${token}; Max-Age=${SESSION_DAYS * 86_400}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export const signOut = () => `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;

/** The owner's email if the request carries a valid session, or throws UnauthorizedError. */
export async function authenticate(request: Request, env: Env, now = Date.now()): Promise<string> {
  if (env.ALLOW_UNAUTHENTICATED === 'true') return env.OWNER_EMAIL;
  const key = loginKey(env);

  const token = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  const [expires, signature] = token?.split('.') ?? [];
  if (!expires || !signature || !/^\d+$/.test(expires)) throw new UnauthorizedError();
  if (Number(expires) * 1000 <= now) throw new UnauthorizedError('Session expired; open your sign-in link again');
  if (!(await same(signature, await sign(key, payload(Number(expires)))))) throw new UnauthorizedError();
  return env.OWNER_EMAIL;
}

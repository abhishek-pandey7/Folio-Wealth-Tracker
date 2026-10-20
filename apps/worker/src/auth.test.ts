import { UnauthorizedError } from '@folio/core';
import { describe, expect, it } from 'vitest';
import { authenticate, signIn, signOut } from './auth.js';
import type { Env } from './env.js';

const KEY = 'k'.repeat(16) + 'Zx9_-randomish-key-0123456789';
const env = { OWNER_EMAIL: 'owner@example.com', LOGIN_KEY: KEY } as Env;
const NOW = Date.UTC(2026, 9, 20);

/** The request the browser sends back after receiving a Set-Cookie header. */
function requestWith(setCookie: string): Request {
  return new Request('https://folio.test/api/portfolio', { headers: { cookie: setCookie.split(';')[0] as string } });
}

describe('sign-in link', () => {
  it('turns the right key into a session that authenticates', async () => {
    const cookie = await signIn(KEY, env, NOW);
    expect(cookie).toMatch(/HttpOnly; Secure; SameSite=Strict/);
    expect(await authenticate(requestWith(cookie), env, NOW + 1000)).toBe('owner@example.com');
  });

  it('rejects a wrong key, a missing key and a non-string key', async () => {
    for (const key of [`${KEY}x`, '', undefined, 42]) {
      await expect(signIn(key, env, NOW)).rejects.toBeInstanceOf(UnauthorizedError);
    }
  });

  it('rejects requests without a valid session', async () => {
    const cookie = await signIn(KEY, env, NOW);
    const [, token] = (cookie.split(';')[0] as string).split('=');
    const [expires, signature] = (token as string).split('.');
    const reject = (header: string, at = NOW) =>
      expect(
        authenticate(new Request('https://folio.test/api', { headers: { cookie: header } }), env, at),
      ).rejects.toBeInstanceOf(UnauthorizedError);

    await reject('');
    await reject('folio_session=garbage');
    await reject(`folio_session=${Number(expires) + 86_400}.${signature}`); // extended expiry, old signature
    await reject(`folio_session=${expires}.${signature}x`);
    await reject(cookie.split(';')[0] as string, NOW + 91 * 86_400_000); // expired after 90 days
  });

  it('signs every device out when the key is rotated', async () => {
    const cookie = await signIn(KEY, env, NOW);
    const rotated = { ...env, LOGIN_KEY: `${KEY}-rotated` } as Env;
    await expect(authenticate(requestWith(cookie), rotated, NOW)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('fails closed when no key, or a short one, is configured', async () => {
    const cookie = await signIn(KEY, env, NOW);
    for (const LOGIN_KEY of [undefined, 'short']) {
      const broken = { ...env, LOGIN_KEY } as Env;
      await expect(authenticate(requestWith(cookie), broken, NOW)).rejects.toBeInstanceOf(UnauthorizedError);
      await expect(signIn('short', broken, NOW)).rejects.toBeInstanceOf(UnauthorizedError);
    }
  });

  it('clears the cookie on sign-out', () => {
    expect(signOut()).toMatch(/^folio_session=; Max-Age=0;/);
  });
});

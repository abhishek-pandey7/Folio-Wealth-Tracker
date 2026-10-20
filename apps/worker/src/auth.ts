// Cloudflare Access sits in front of the whole hostname and only lets the
// owner's email through. The Worker checks Access's signed JWT as well, so a
// request that somehow bypassed Access (a misconfigured policy, a route added
// later) is still refused. Fails closed: without Access configured, nothing passes.

import { ForbiddenError } from '@folio/core';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env } from './env.js';

// Per isolate: Access rotates its signing keys rarely, and jose caches them.
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function keysFor(teamDomain: string) {
  let keys = keySets.get(teamDomain);
  if (!keys) {
    keys = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', teamDomain));
    keySets.set(teamDomain, keys);
  }
  return keys;
}

/** The verified email of the caller, or throws ForbiddenError. */
export async function authenticate(request: Request, env: Env): Promise<string> {
  if (env.ALLOW_UNAUTHENTICATED === 'true') return env.OWNER_EMAIL;

  const teamDomain = env.ACCESS_TEAM_DOMAIN?.replace(/\/$/, '');
  if (!teamDomain || !env.ACCESS_AUD) throw new ForbiddenError('Cloudflare Access is not configured');

  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) throw new ForbiddenError('Sign in through Cloudflare Access');

  let email: unknown;
  try {
    const { payload } = await jwtVerify(token, keysFor(teamDomain), { issuer: teamDomain, audience: env.ACCESS_AUD });
    email = payload.email;
  } catch {
    throw new ForbiddenError('Invalid Cloudflare Access token');
  }
  if (typeof email !== 'string' || email.toLowerCase() !== env.OWNER_EMAIL.toLowerCase()) {
    throw new ForbiddenError('This account is not allowed');
  }
  return env.OWNER_EMAIL;
}

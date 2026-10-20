// Sign-in for the Cloudflare deployment. Visitors without a session browse the
// public demo; the owner opens /#key=… once per device to see their own data.
// The fragment never reaches a server, so the key stays out of logs; it is
// posted once, then removed from the address bar and history.
//
// Locally (NestJS) there is no /api/session at all, which counts as the owner.

const KEY_FRAGMENT = /^#key=([A-Za-z0-9_-]{32,})$/;

export type SessionMode = 'owner' | 'demo';

export async function startSession(): Promise<SessionMode> {
  const match = KEY_FRAGMENT.exec(window.location.hash);
  if (match) {
    // Drop the key before anything else, so it is not left in the URL even if the request fails.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: match[1] }),
    }).catch(() => undefined);
  }
  const response = await fetch('/api/session', { headers: { accept: 'application/json' } }).catch(() => undefined);
  if (!response?.ok) return 'owner';
  const body = (await response.json().catch(() => undefined)) as { mode?: unknown } | undefined;
  return body?.mode === 'demo' ? 'demo' : 'owner';
}

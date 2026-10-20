// Sign-in for the Cloudflare deployment: the owner opens /#key=… once per
// device. The fragment never reaches a server, so the key stays out of logs;
// it is posted once, then removed from the address bar and history.
//
// Locally (NestJS) there is no /api/session at all, which counts as signed in.

const KEY_FRAGMENT = /^#key=([A-Za-z0-9_-]{32,})$/;

export async function startSession(): Promise<'open' | 'locked'> {
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
  return response?.status === 401 ? 'locked' : 'open';
}

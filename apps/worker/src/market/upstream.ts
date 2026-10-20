import { NotFoundError, UpstreamError } from '@folio/core';

const TIMEOUT_MS = 10_000;

/**
 * GETs JSON from a third-party API. Failures become UpstreamError (502) with
 * the provider named in logs only; a 404 becomes NotFoundError.
 */
export async function getJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await get(url, init);
  try {
    return (await response.json()) as T;
  } catch {
    throw new UpstreamError(`Market data provider sent an unreadable response (${host(url)})`);
  }
}

export async function get(url: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { 'user-agent': 'Mozilla/5.0 (folio)', accept: '*/*', ...init.headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new UpstreamError(`Market data provider unreachable (${host(url)}): ${(error as Error).message}`);
  }
  if (response.status === 404) throw new NotFoundError('Not found at the market data provider');
  if (!response.ok && response.status !== 206) {
    throw new UpstreamError(`Market data provider returned ${response.status} (${host(url)})`);
  }
  return response;
}

const host = (url: string) => new URL(url).host;

/** Runs tasks with at most `limit` in flight. Workers allow six open connections per invocation. */
export async function pool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await task(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Drops binary floating-point noise (2845.300048828125 → "2845.3"), like the Go side's decimal rounding. */
export const decimal = (n: number, places = 4): string => String(Number(n.toFixed(places)));

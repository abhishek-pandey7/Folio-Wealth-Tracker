import type { z } from 'zod';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(path, { ...init, headers: { accept: 'application/json', ...init.headers } });
  const body: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined);

  // The session ended (expired, or the key was rotated): reloading shows the locked screen.
  if (response.status === 401) window.location.reload();
  if (!response.ok) {
    const message = (body as { message?: unknown } | undefined)?.message;
    throw new ApiError(typeof message === 'string' ? message : `Request failed (${response.status})`, response.status);
  }
  return body;
}

/**
 * GETs an API path and validates the body against its shared contract, so a
 * component only ever sees data that matches its declared type.
 */
export async function getJson<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> {
  return schema.parse(await request(path));
}

export async function putJson<S extends z.ZodType>(path: string, body: unknown, schema: S): Promise<z.infer<S>> {
  const result = await request(path, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return schema.parse(result);
}

export async function deleteJson(path: string): Promise<void> {
  await request(path, { method: 'DELETE' });
}

export async function postJson<S extends z.ZodType>(path: string, body: unknown, schema: S): Promise<z.infer<S>> {
  const result = await request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return schema.parse(result);
}

export async function patchJson<S extends z.ZodType>(path: string, body: unknown, schema: S): Promise<z.infer<S>> {
  const result = await request(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return schema.parse(result);
}

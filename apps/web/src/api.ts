import type { z } from 'zod';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * GETs an API path and validates the body against its shared contract, so a
 * component only ever sees data that matches its declared type.
 */
export async function getJson<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> {
  const response = await fetch(path, { headers: { accept: 'application/json' } });
  const body: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const message = (body as { message?: unknown } | undefined)?.message;
    throw new ApiError(typeof message === 'string' ? message : `Request failed (${response.status})`, response.status);
  }
  return schema.parse(body);
}

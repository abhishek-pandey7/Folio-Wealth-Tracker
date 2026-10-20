import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

const storage = new AsyncLocalStorage<{ requestId: string }>();

/**
 * Gives every request an ID (reusing the caller's if sent) that follows it
 * through async code without threading it through every function signature.
 * Outgoing calls to the market gateway forward it, so one user action can be
 * traced across both services' logs.
 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(REQUEST_ID_HEADER);
  const requestId = incoming && incoming.length <= 64 ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, requestId);
  storage.run({ requestId }, next);
}

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

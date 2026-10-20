/**
 * Errors the business logic raises, each carrying the HTTP status it maps to.
 * Adapters (NestJS locally, Hono on Workers) translate them in one place, so
 * the core never imports a web framework.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(400, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message);
  }
}

export class UnprocessableError extends AppError {
  constructor(message: string) {
    super(422, message);
  }
}

/** An upstream market data source failed or answered with something unusable. */
export class UpstreamError extends AppError {
  constructor(message = 'Market data is temporarily unavailable') {
    super(502, message);
  }
}

export class UnavailableError extends AppError {
  constructor(message: string) {
    super(503, message);
  }
}

/** Postgres reports unique violations as SQLSTATE 23505; Drizzle may wrap the driver error. */
export function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e.code === '23505' || e.cause?.code === '23505';
}

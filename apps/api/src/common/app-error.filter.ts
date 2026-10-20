import { STATUS_CODES } from 'node:http';
import { AppError } from '@folio/core';
import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

/** Maps the core's framework-free errors to the same JSON shape Nest uses for its own. */
@Catch(AppError)
export class AppErrorFilter implements ExceptionFilter {
  catch(error: AppError, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(error.status)
      .json({ statusCode: error.status, message: error.message, error: STATUS_CODES[error.status] });
  }
}

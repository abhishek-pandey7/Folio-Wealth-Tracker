import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { z } from 'zod';
import { currentRequestId, REQUEST_ID_HEADER } from '../common/request-context.js';
import type { Env } from '../config/env.js';

interface GatewayErrorBody {
  error?: { code?: string; message?: string };
}

/**
 * Typed HTTP client for the Go market gateway. Every response is validated
 * against its shared zod contract, and gateway failures are translated into
 * HTTP errors that make sense to the browser.
 */
@Injectable()
export class MarketGatewayClient {
  private readonly logger = new Logger(MarketGatewayClient.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = config.get('MARKET_GATEWAY_URL', { infer: true }).replace(/\/$/, '');
    this.timeoutMs = config.get('MARKET_GATEWAY_TIMEOUT_MS', { infer: true });
  }

  /** `timeoutMs` overrides the default for slow calls, such as a screen whose cache is still cold. */
  async get<S extends z.ZodType>(path: string, schema: S, options: { timeoutMs?: number } = {}): Promise<z.infer<S>> {
    const response = await this.fetch(path, options.timeoutMs ?? this.timeoutMs);
    const body: unknown = await response.json().catch(() => undefined);

    if (!response.ok) {
      throw this.toHttpException(response.status, body as GatewayErrorBody | undefined, path);
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      this.logger.error(`Gateway response for ${path} broke the contract: ${parsed.error.message}`);
      throw new BadGatewayException('Market data service returned an unexpected response');
    }
    return parsed.data;
  }

  /** Liveness probe with a short timeout, for the health endpoint. */
  async isUp(): Promise<boolean> {
    try {
      return (await this.fetch('/healthz', 1_500)).ok;
    } catch {
      return false;
    }
  }

  private async fetch(path: string, timeoutMs: number): Promise<Response> {
    const headers: Record<string, string> = { accept: 'application/json' };
    const requestId = currentRequestId();
    if (requestId) {
      headers[REQUEST_ID_HEADER] = requestId;
    }

    try {
      return await fetch(`${this.baseUrl}${path}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      this.logger.warn(`Gateway unreachable for ${path}: ${(error as Error).message}`);
      throw new ServiceUnavailableException('Market data service is unavailable');
    }
  }

  private toHttpException(status: number, body: GatewayErrorBody | undefined, path: string): HttpException {
    const message = body?.error?.message ?? `Market data request failed (${status})`;
    switch (status) {
      case 400:
        return new BadRequestException(message);
      case 404:
        return new NotFoundException(message);
      case 422:
        return new UnprocessableEntityException(message);
      default:
        // Upstream details (which provider, why) stay in our logs, not in the browser.
        this.logger.warn(`Gateway ${status} for ${path}: ${message}`);
        return new BadGatewayException('Market data is temporarily unavailable');
    }
  }
}

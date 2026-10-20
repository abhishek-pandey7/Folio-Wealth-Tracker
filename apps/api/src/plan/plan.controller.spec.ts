import type { SipsService } from '@folio/core';
import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import { CronController } from './plan.controller.js';

describe('CronController', () => {
  const runAll = vi.fn(async () => ({ users: 1, recorded: 2 }));
  const controller = (secret?: string) =>
    new CronController(
      { runAll } as unknown as SipsService,
      { get: () => secret } as unknown as ConfigService<Env, true>,
    );

  it('is disabled when no secret is configured', async () => {
    await expect(controller(undefined).run('anything')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a wrong secret and accepts the right one', async () => {
    const secret = 'a-long-random-secret-for-cron-123';
    await expect(controller(secret).run('wrong')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller(secret).run(secret)).resolves.toEqual({ users: 1, recorded: 2 });
  });
});

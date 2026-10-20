import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.js';

describe('validateEnv', () => {
  it('applies defaults for local development', () => {
    const env = validateEnv({});

    expect(env.API_PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
  });

  it('coerces numeric strings from the environment', () => {
    expect(validateEnv({ API_PORT: '8080' }).API_PORT).toBe(8080);
  });

  it('reports every invalid variable at once', () => {
    expect(() => validateEnv({ API_PORT: 'abc', NODE_ENV: 'staging' })).toThrow(
      /API_PORT[\s\S]*NODE_ENV|NODE_ENV[\s\S]*API_PORT/,
    );
  });
});

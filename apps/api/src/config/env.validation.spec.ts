import { describe, it, expect } from 'vitest';
import { validateEnvironment } from './env.validation.js';

describe('validateEnvironment', () => {
  it('should validate successfully with required and default variables', () => {
    const config = {
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    };

    const validated = validateEnvironment(config);
    expect(validated.DATABASE_URL).toBe(config.DATABASE_URL);
    expect(validated.API_PORT).toBe(3001);
    expect(validated.API_HOST).toBe('0.0.0.0');
    expect(validated.NODE_ENV).toBe('development');
  });

  it('should throw an error when DATABASE_URL is missing', () => {
    const config = {
      API_PORT: 3001,
    };

    expect(() => validateEnvironment(config)).toThrowError(
      /DATABASE_URL is required for backend foundation/,
    );
  });

  it('should coerce API_PORT from string to number', () => {
    const config = {
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      API_PORT: '8080',
    };

    const validated = validateEnvironment(config);
    expect(validated.API_PORT).toBe(8080);
  });

  it('should fail validation if API_PORT is invalid', () => {
    const config = {
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      API_PORT: '999999',
    };

    expect(() => validateEnvironment(config)).toThrowError(/API_PORT/);
  });
});

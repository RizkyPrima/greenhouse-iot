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

  it('requires secure MQTT and management URLs in production', () => {
    expect(() => validateEnvironment({
      DATABASE_URL: '******localhost:5432/db',
      NODE_ENV: 'production',
      MQTT_PROTOCOL: 'mqtt',
      EMQX_API_URL: 'http://broker.example/api/v5',
    })).toThrowError(/MQTT_PROTOCOL must be mqtts/);

    expect(() => validateEnvironment({
      DATABASE_URL: '******localhost:5432/db',
      NODE_ENV: 'production',
      MQTT_PROTOCOL: 'mqtts',
      EMQX_API_URL: 'http://broker.example/api/v5',
    })).toThrowError(/EMQX_API_URL must use HTTPS/);

    expect(() => validateEnvironment({
      DATABASE_URL: '******localhost:5432/db',
      NODE_ENV: 'production',
      MQTT_PROTOCOL: 'mqtts',
      EMQX_API_URL: 'https://broker.example/api/v5',
      JWT_SECRET: 'test-secret',
      JWT_REFRESH_SECRET: 'test-refresh-secret',
      CORS_ORIGIN: '*',
    })).toThrowError(/CORS_ORIGIN must contain explicit origins/);
  });
});

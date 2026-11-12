import { describe, expect, it } from 'vitest';
import {
  getSimulatorConfig,
  isDisposableTestDatabase,
} from './simulator-config.js';

const validEnv = {
  MQTT_HOST: 'localhost',
  MQTT_PORT: '1883',
  MQTT_PROTOCOL: 'mqtt',
  MQTT_USERNAME: 'greenhouse_backend',
  MQTT_PASSWORD: 'test-only-password',
  SIM_GH_ID: 'GH-TEST-01',
  SIM_DEVICE_ID: 'ESP32-TEST-01',
  SIMULATOR_ALLOW_DB_WRITES: 'true',
  DATABASE_URL: 'postgresql://test',
};

describe('telemetry simulator configuration', () => {
  it('uses the backend MQTT credentials and explicitly configured test identity', () => {
    expect(getSimulatorConfig(validEnv)).toEqual({
      brokerUrl: 'mqtt://localhost:1883',
      username: 'greenhouse_backend',
      password: 'test-only-password',
      greenhouseId: 'GH-TEST-01',
      deviceId: 'ESP32-TEST-01',
    });
  });

  it('refuses missing MQTT credentials', () => {
    expect(() => getSimulatorConfig({ ...validEnv, MQTT_PASSWORD: '' })).toThrow(
      /MQTT_USERNAME and MQTT_PASSWORD are required/,
    );
  });

  it('refuses an identity without a test marker', () => {
    expect(() => getSimulatorConfig({ ...validEnv, SIM_DEVICE_ID: 'ESP32-01' })).toThrow(
      /must both contain a TEST identifier/,
    );
  });

  it('requires explicit permission before database writes', () => {
    expect(() =>
      getSimulatorConfig({ ...validEnv, SIMULATOR_ALLOW_DB_WRITES: 'false' }),
    ).toThrow(/disposable test database/);
  });

  it('distinguishes disposable test databases from other databases', () => {
    expect(isDisposableTestDatabase('greenhouse_test')).toBe(true);
    expect(isDisposableTestDatabase('greenhouse_dev')).toBe(false);
    expect(isDisposableTestDatabase('production')).toBe(false);
  });
});

export interface SimulatorConfig {
  brokerUrl: string;
  username: string;
  password: string;
  greenhouseId: string;
  deviceId: string;
}

export function getSimulatorConfig(
  env: NodeJS.ProcessEnv = process.env,
): SimulatorConfig {
  const username = env.MQTT_USERNAME?.trim();
  const password = env.MQTT_PASSWORD;
  const host = env.MQTT_HOST?.trim();
  const protocol = env.MQTT_PROTOCOL?.trim() || 'mqtt';
  const port = Number(env.MQTT_PORT || 1883);
  const greenhouseId = env.SIM_GH_ID?.trim();
  const deviceId = env.SIM_DEVICE_ID?.trim();

  if (!username || !password) {
    throw new Error('MQTT_USERNAME and MQTT_PASSWORD are required for the telemetry simulator');
  }
  if (!host) {
    throw new Error('MQTT_HOST is required for the telemetry simulator');
  }
  if (!['mqtt', 'mqtts'].includes(protocol)) {
    throw new Error('MQTT_PROTOCOL must be mqtt or mqtts');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('MQTT_PORT must be a valid TCP port');
  }
  if (!greenhouseId || !deviceId) {
    throw new Error('SIM_GH_ID and SIM_DEVICE_ID must identify a registered test device');
  }
  if (!/(^|[-_])test([-_]|$)/i.test(greenhouseId) || !/(^|[-_])test([-_]|$)/i.test(deviceId)) {
    throw new Error('SIM_GH_ID and SIM_DEVICE_ID must both contain a TEST identifier');
  }
  if (env.SIMULATOR_ALLOW_DB_WRITES !== 'true') {
    throw new Error('Set SIMULATOR_ALLOW_DB_WRITES=true only when targeting a disposable test database');
  }
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to verify the registered test device');
  }

  return {
    brokerUrl: `${protocol}://${host}:${port}`,
    username,
    password,
    greenhouseId,
    deviceId,
  };
}

export function isDisposableTestDatabase(databaseName: string): boolean {
  return /(^|[_-])test([_-]|$)/i.test(databaseName);
}

import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  host: process.env.API_HOST || '0.0.0.0',
  port: parseInt(process.env.API_PORT || '3001', 10),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
}));

export const databaseConfig = registerAs('database', () => ({
  url: process.env.DATABASE_URL || '',
}));

export const redisConfig = registerAs('redis', () => ({
  url: process.env.REDIS_URL,
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
}));

export const mqttConfig = registerAs('mqtt', () => ({
  host: process.env.MQTT_HOST || 'localhost',
  port: parseInt(process.env.MQTT_PORT || '1883', 10),
  protocol: process.env.MQTT_PROTOCOL || 'mqtt',
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
  clientId: process.env.MQTT_CLIENT_ID || 'greenhouse-api',
  keepalive: parseInt(process.env.MQTT_KEEPALIVE || '30', 10),
  connectTimeout: parseInt(process.env.MQTT_CONNECT_TIMEOUT || '10000', 10),
  reconnectPeriod: parseInt(process.env.MQTT_RECONNECT_PERIOD || '3000', 10),
  clean: process.env.MQTT_CLEAN !== 'false',
}));

import { ParsedGreenhouseTopic } from './mqtt.constants.js';

export type MqttConnectionStatus =
  | 'connected'
  | 'connecting'
  | 'reconnecting'
  | 'disconnected'
  | 'offline'
  | 'error';

export interface MqttPublishOptions {
  qos?: 0 | 1;
  retain?: boolean;
}

export interface MqttMessage<T = unknown> {
  topic: string;
  parsedTopic: ParsedGreenhouseTopic | null;
  payload: T;
  rawPayload: Buffer;
  receivedAt: string;
}

export type MqttMessageHandler = (message: MqttMessage) => void | Promise<void>;

export interface MqttConfigOptions {
  host: string;
  port: number;
  protocol: string;
  username?: string;
  password?: string;
  clientId: string;
  keepalive: number;
  connectTimeout: number;
  reconnectPeriod: number;
  clean: boolean;
}

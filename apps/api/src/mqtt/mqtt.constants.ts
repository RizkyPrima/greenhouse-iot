export const MQTT_MESSAGE_TYPES = [
  'telemetry',
  'status',
  'event',
  'alarm',
  'command',
  'response',
  'config',
] as const;

export type MqttMessageType = (typeof MQTT_MESSAGE_TYPES)[number];

export const DEFAULT_MQTT_SUBSCRIPTIONS: readonly string[] = [
  'greenhouse/+/+/telemetry',
  'greenhouse/+/+/status',
  'greenhouse/+/+/event',
  'greenhouse/+/+/alarm',
  'greenhouse/+/+/response',
] as const;

export interface ParsedGreenhouseTopic {
  greenhouseId: string;
  deviceId: string;
  messageType: MqttMessageType;
  raw: string;
}

/**
 * Builds a standardized MQTT topic for greenhouse communication:
 * greenhouse/{greenhouse_id}/{device_id}/{message_type}
 */
export function buildGreenhouseTopic(
  greenhouseId: string,
  deviceId: string,
  messageType: MqttMessageType,
): string {
  return `greenhouse/${greenhouseId}/${deviceId}/${messageType}`;
}

/**
 * Parses a greenhouse MQTT topic into structured components:
 * Example: greenhouse/GH001/CTRL001/telemetry -> { greenhouseId: 'GH001', deviceId: 'CTRL001', messageType: 'telemetry' }
 */
export function parseGreenhouseTopic(topic: string): ParsedGreenhouseTopic | null {
  const parts = topic.split('/');
  if (parts.length !== 4 || parts[0] !== 'greenhouse') {
    return null;
  }

  const [, greenhouseId, deviceId, messageType] = parts;

  if (!MQTT_MESSAGE_TYPES.includes(messageType as MqttMessageType)) {
    return null;
  }

  return {
    greenhouseId,
    deviceId,
    messageType: messageType as MqttMessageType,
    raw: topic,
  };
}

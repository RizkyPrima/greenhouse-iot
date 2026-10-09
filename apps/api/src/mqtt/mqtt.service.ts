import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import mqtt, { MqttClient } from 'mqtt';
import {
  DEFAULT_MQTT_SUBSCRIPTIONS,
  parseGreenhouseTopic,
} from './mqtt.constants.js';
import {
  MqttConnectionStatus,
  MqttMessage,
  MqttMessageHandler,
  MqttPublishOptions,
} from './mqtt.types.js';

@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private client: MqttClient | null = null;
  private status: MqttConnectionStatus = 'disconnected';
  private readonly messageHandlers = new Set<MqttMessageHandler>();
  private readonly activeSubscriptions = new Set<string>(DEFAULT_MQTT_SUBSCRIPTIONS);

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }

  async connect(): Promise<void> {
    if (this.client && this.client.connected) {
      return;
    }

    const host = this.configService.get<string>('mqtt.host') || 'localhost';
    const port = this.configService.get<number>('mqtt.port') || 1883;
    const protocol = this.configService.get<string>('mqtt.protocol') || 'mqtt';
    const username = this.configService.get<string>('mqtt.username') || undefined;
    const password = this.configService.get<string>('mqtt.password') || undefined;
    const baseClientId = this.configService.get<string>('mqtt.clientId') || 'greenhouse-api';
    const clientId = `${baseClientId}-${Math.random().toString(36).substring(2, 7)}`;
    const keepalive = this.configService.get<number>('mqtt.keepalive') || 30;
    const connectTimeout = this.configService.get<number>('mqtt.connectTimeout') || 10000;
    const reconnectPeriod = this.configService.get<number>('mqtt.reconnectPeriod') || 3000;
    const clean = this.configService.get<boolean>('mqtt.clean') ?? true;

    const brokerUrl = `${protocol}://${host}:${port}`;
    this.status = 'connecting';

    this.logger.log(`[MQTT_CONNECTING] Connecting to broker at ${brokerUrl} with clientId="${clientId}"`);

    try {
      const connectOptions: mqtt.IClientOptions = {
        clientId,
        clean,
        keepalive,
        connectTimeout,
        reconnectPeriod,
      };

      if (username) {
        connectOptions.username = username;
      }
      if (password) {
        connectOptions.password = password;
      }

      this.client = mqtt.connect(brokerUrl, connectOptions);
      this.setupEventHandlers(clientId);
    } catch (error) {
      this.status = 'error';
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[MQTT_ERROR] Initial connection attempt failed: ${errorMessage}`);
    }
  }

  async disconnect(): Promise<void> {
    if (!this.client) {
      this.status = 'disconnected';
      return;
    }

    this.logger.log('[MQTT_DISCONNECTING] Gracefully disconnecting from MQTT broker');

    return new Promise((resolve) => {
      this.client?.end(false, {}, () => {
        this.status = 'disconnected';
        this.client = null;
        this.logger.log('[MQTT_DISCONNECTED] Disconnected gracefully from MQTT broker');
        resolve();
      });
    });
  }

  isConnected(): boolean {
    return this.client !== null && this.client.connected;
  }

  getConnectionStatus(): MqttConnectionStatus {
    return this.status;
  }

  async publish(
    topic: string,
    payload: string | object | Buffer,
    options?: MqttPublishOptions,
  ): Promise<void> {
    if (!this.client || !this.client.connected) {
      throw new Error(`[MQTT_PUBLISH_FAILED] Cannot publish to topic "${topic}": MQTT client is not connected`);
    }

    const qos = options?.qos ?? 0;
    const retain = options?.retain ?? false;

    let messageBuffer: Buffer;
    if (Buffer.isBuffer(payload)) {
      messageBuffer = payload;
    } else if (typeof payload === 'object') {
      messageBuffer = Buffer.from(JSON.stringify(payload));
    } else {
      messageBuffer = Buffer.from(String(payload));
    }

    return new Promise((resolve, reject) => {
      this.client!.publish(topic, messageBuffer, { qos, retain }, (error) => {
        if (error) {
          this.logger.error(`[MQTT_PUBLISH_ERROR] Failed publishing to "${topic}": ${error.message}`);
          reject(error);
        } else {
          this.logger.log(`[MQTT_PUBLISH] Published to topic="${topic}" (QoS: ${qos}, Retain: ${retain})`);
          resolve();
        }
      });
    });
  }

  async subscribe(topic: string | string[], options?: { qos?: 0 | 1 }): Promise<void> {
    if (!this.client || !this.client.connected) {
      const topics = Array.isArray(topic) ? topic : [topic];
      topics.forEach((t) => this.activeSubscriptions.add(t));
      return;
    }

    const qos = options?.qos ?? 0;
    const topics = Array.isArray(topic) ? topic : [topic];

    return new Promise((resolve, reject) => {
      this.client!.subscribe(topic, { qos }, (error, granted) => {
        if (error) {
          this.logger.error(`[MQTT_SUBSCRIBE_ERROR] Failed subscribing to ${JSON.stringify(topic)}: ${error.message}`);
          reject(error);
        } else {
          topics.forEach((t) => this.activeSubscriptions.add(t));
          this.logger.log(`[MQTT_SUBSCRIBE] Subscribed to ${JSON.stringify(topic)} (Granted QoS: ${JSON.stringify(granted?.map((g) => g.qos))})`);
          resolve();
        }
      });
    });
  }

  async unsubscribe(topic: string | string[]): Promise<void> {
    if (!this.client || !this.client.connected) {
      const topics = Array.isArray(topic) ? topic : [topic];
      topics.forEach((t) => this.activeSubscriptions.delete(t));
      return;
    }

    const topics = Array.isArray(topic) ? topic : [topic];

    return new Promise((resolve, reject) => {
      this.client!.unsubscribe(topic, (error) => {
        if (error) {
          this.logger.error(`[MQTT_UNSUBSCRIBE_ERROR] Failed unsubscribing from ${JSON.stringify(topic)}: ${error.message}`);
          reject(error);
        } else {
          topics.forEach((t) => this.activeSubscriptions.delete(t));
          this.logger.log(`[MQTT_UNSUBSCRIBE] Unsubscribed from ${JSON.stringify(topic)}`);
          resolve();
        }
      });
    });
  }

  onMessage(handler: MqttMessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  private setupEventHandlers(clientId: string): void {
    if (!this.client) return;

    this.client.on('connect', () => {
      this.status = 'connected';
      this.logger.log(`[MQTT_CONNECTED] Connected to EMQX broker as "${clientId}"`);

      // Restore/apply default subscriptions
      if (this.activeSubscriptions.size > 0) {
        const topics = Array.from(this.activeSubscriptions);
        this.client?.subscribe(topics, { qos: 0 }, (err) => {
          if (err) {
            this.logger.error(`[MQTT_SUBSCRIPTION_ERROR] Failed restoring subscriptions: ${err.message}`);
          } else {
            this.logger.log(`[MQTT_SUBSCRIPTION_ACTIVE] Active subscriptions: ${JSON.stringify(topics)}`);
          }
        });
      }
    });

    this.client.on('reconnect', () => {
      this.status = 'reconnecting';
      this.logger.warn(`[MQTT_RECONNECTING] Reconnecting to EMQX broker as "${clientId}"...`);
    });

    this.client.on('close', () => {
      this.status = 'disconnected';
      this.logger.warn('[MQTT_DISCONNECTED] Connection to EMQX broker closed');
    });

    this.client.on('offline', () => {
      this.status = 'offline';
      this.logger.warn('[MQTT_OFFLINE] EMQX broker is offline');
    });

    this.client.on('error', (err) => {
      this.status = 'error';
      this.logger.error(`[MQTT_ERROR] MQTT Client error: ${err.message}`);
    });

    this.client.on('message', (topic: string, rawPayload: Buffer) => {
      this.handleIncomingMessage(topic, rawPayload);
    });
  }

  private handleIncomingMessage(topic: string, rawPayload: Buffer): void {
    const receivedAt = new Date().toISOString();
    const rawString = rawPayload.toString('utf-8');

    let payload: unknown;
    try {
      payload = JSON.parse(rawString);
    } catch {
      payload = rawString;
    }

    const parsedTopic = parseGreenhouseTopic(topic);
    const messageType = parsedTopic?.messageType || 'custom';

    this.logger.log(`[MQTT_MESSAGE_RECEIVED] topic="${topic}" type="${messageType}" receivedAt="${receivedAt}"`);

    const message: MqttMessage = {
      topic,
      parsedTopic,
      payload,
      rawPayload,
      receivedAt,
    };

    // Dispatch to registered subscribers asynchronously
    for (const handler of this.messageHandlers) {
      try {
        const result = handler(message);
        if (result instanceof Promise) {
          result.catch((handlerErr) => {
            this.logger.error(`[MQTT_DISPATCH_ERROR] Error in message handler: ${handlerErr.message}`);
          });
        }
      } catch (handlerErr) {
        const errorMsg = handlerErr instanceof Error ? handlerErr.message : String(handlerErr);
        this.logger.error(`[MQTT_DISPATCH_ERROR] Synchronous error in message handler: ${errorMsg}`);
      }
    }
  }
}

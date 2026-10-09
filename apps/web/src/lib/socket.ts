import { io, Socket } from 'socket.io-client';
import { ConnectionStatus } from '@/types';

const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001';

class RealtimeSocketManager {
  private socket: Socket | null = null;
  private statusListeners: Set<(status: ConnectionStatus) => void> = new Set();
  private status: ConnectionStatus = 'DISCONNECTED';

  getStatus(): ConnectionStatus {
    return this.status;
  }

  private setStatus(newStatus: ConnectionStatus) {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.statusListeners.forEach((fn) => fn(newStatus));
    }
  }

  onStatusChange(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  connect(): Socket {
    if (this.socket && this.socket.connected) {
      return this.socket;
    }

    if (this.socket) {
      this.socket.connect();
      return this.socket;
    }

    this.setStatus('RECONNECTING');

    this.socket = io(`${WS_BASE_URL}/realtime`, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });

    this.socket.on('connect', () => {
      this.setStatus('CONNECTED');
    });

    this.socket.on('disconnect', () => {
      this.setStatus('DISCONNECTED');
    });

    this.socket.on('connect_error', () => {
      this.setStatus('RECONNECTING');
    });

    this.socket.on('reconnect_attempt', () => {
      this.setStatus('RECONNECTING');
    });

    this.socket.on('reconnect', () => {
      this.setStatus('CONNECTED');
    });

    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.setStatus('DISCONNECTED');
    }
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  subscribeGreenhouse(greenhouseId: string) {
    if (!this.socket) this.connect();
    this.socket?.emit('subscribe:greenhouse', { greenhouseId });
  }

  unsubscribeGreenhouse(greenhouseId: string) {
    this.socket?.emit('unsubscribe:greenhouse', { greenhouseId });
  }

  subscribeDevice(deviceMqttId: string) {
    if (!this.socket) this.connect();
    this.socket?.emit('subscribe:device', { deviceMqttId });
  }
}

export const socketManager = new RealtimeSocketManager();

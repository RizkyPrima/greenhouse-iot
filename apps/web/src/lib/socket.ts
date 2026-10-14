import { io, Socket } from 'socket.io-client';
import { ConnectionStatus } from '@/types';

const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001';

class RealtimeSocketManager {
  private socket: Socket | null = null;
  private statusListeners: Set<(status: ConnectionStatus) => void> = new Set();
  private status: ConnectionStatus = 'DISCONNECTED';
  private currentToken: string | null = null;

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

  connect(explicitToken?: string | null): Socket {
    const token =
      explicitToken !== undefined
        ? explicitToken
        : typeof window !== 'undefined'
        ? localStorage.getItem('greenhouse_access_token') || localStorage.getItem('access_token')
        : null;

    this.currentToken = token;

    if (this.socket && this.socket.connected) {
      return this.socket;
    }

    if (this.socket) {
      this.socket.auth = { token };
      this.socket.connect();
      return this.socket;
    }

    this.setStatus('RECONNECTING');

    this.socket = io(`${WS_BASE_URL}/realtime`, {
      transports: ['websocket', 'polling'],
      auth: (cb: (data: Record<string, unknown>) => void) => {
        const activeToken =
          this.currentToken ||
          (typeof window !== 'undefined'
            ? localStorage.getItem('greenhouse_access_token') || localStorage.getItem('access_token')
            : null);
        cb({ token: activeToken });
      },
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

  updateAuthToken(token: string | null) {
    this.currentToken = token;
    if (this.socket) {
      this.socket.auth = { token };
      if (!this.socket.connected && token) {
        this.socket.connect();
      }
    } else if (token) {
      this.connect(token);
    }
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
    if (!this.socket || !this.socket.connected) {
      this.connect();
    }
    this.socket?.emit('subscribe:greenhouse', { greenhouseId });
  }

  unsubscribeGreenhouse(greenhouseId: string) {
    this.socket?.emit('unsubscribe:greenhouse', { greenhouseId });
  }

  subscribeDevice(deviceMqttId: string) {
    if (!this.socket || !this.socket.connected) {
      this.connect();
    }
    this.socket?.emit('subscribe:device', { deviceMqttId });
  }
}

export const socketManager = new RealtimeSocketManager();

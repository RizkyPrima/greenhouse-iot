'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { ConnectionStatus, RealtimeDeviceState } from '@/types';
import { socketManager } from '@/lib/socket';

export interface TelemetryUpdatePacket {
  greenhouseId: string;
  deviceMqttId: string;
  payload: {
    seq?: number;
    ts?: number;
    sensors: Array<{ code: string; value: number; unit?: string }>;
  };
  timestamp: string;
}

interface StatusUpdatePacket {
  greenhouseId: string;
  deviceMqttId: string;
  status: string;
  lastSeenAt: string;
}

export interface ActuatorCommandUpdate {
  commandId: string;
  deviceMqttId: string;
  actuatorId: string | null;
  target: string;
  value: unknown;
  status: string;
  result?: { activeState?: boolean } | null;
  error?: string | null;
  completedAt?: string | null;
}

interface SocketContextType {
  status: ConnectionStatus;
  deviceStates: Record<string, RealtimeDeviceState>;
  lastUpdate: string | null;
  latestTelemetry: TelemetryUpdatePacket | null;
  latestCommandUpdate: ActuatorCommandUpdate | null;
  subscribeGreenhouse: (greenhouseId: string) => void;
  unsubscribeGreenhouse: (greenhouseId: string) => void;
  subscribeDevice: (deviceMqttId: string) => void;
  seedDeviceStates: (states: RealtimeDeviceState[]) => void;
  getDeviceState: (deviceMqttId: string) => RealtimeDeviceState | undefined;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>('DISCONNECTED');
  const [deviceStates, setDeviceStates] = useState<Record<string, RealtimeDeviceState>>({});
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [latestTelemetry, setLatestTelemetry] = useState<TelemetryUpdatePacket | null>(null);
  const [latestCommandUpdate, setLatestCommandUpdate] = useState<ActuatorCommandUpdate | null>(null);
  const subscribedGreenhouses = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unsubscribeStatus = socketManager.onStatusChange((newStatus) => {
      setStatus(newStatus);
    });

    const socket = socketManager.connect();

    const handleTelemetry = (packet: TelemetryUpdatePacket) => {
      setLatestTelemetry(packet);
      setLastUpdate(new Date().toISOString());
      setDeviceStates((prev) => {
        const existing = prev[packet.deviceMqttId] ?? {
          deviceMqttId: packet.deviceMqttId,
          greenhouseId: packet.greenhouseId,
          status: 'online',
          lastSeenAt: packet.timestamp,
          lastTelemetryAt: packet.timestamp,
          sensors: {},
        };

        const updatedSensors = { ...existing.sensors };
        if (packet.payload?.sensors) {
          for (const s of packet.payload.sensors) {
            updatedSensors[s.code] = {
              sensorCode: s.code,
              numericValue: s.value,
              unit: s.unit ?? null,
              timestamp: packet.timestamp,
              deviceMqttId: packet.deviceMqttId,
              greenhouseId: packet.greenhouseId,
            };
          }
        }

        return {
          ...prev,
          [packet.deviceMqttId]: {
            ...existing,
            status: 'online',
            lastSeenAt: packet.timestamp,
            lastTelemetryAt: packet.timestamp,
            sequence: packet.payload?.seq ?? existing.sequence,
            sensors: updatedSensors,
          },
        };
      });
    };

    const handleStatus = (packet: StatusUpdatePacket) => {
      setLastUpdate(new Date().toISOString());
      setDeviceStates((prev) => {
        const existing = prev[packet.deviceMqttId];
        const updatedSensors = existing ? { ...existing.sensors } : {};

        if (!existing) {
          return {
            ...prev,
            [packet.deviceMqttId]: {
              deviceMqttId: packet.deviceMqttId,
              greenhouseId: packet.greenhouseId,
              status: packet.status,
              lastSeenAt: packet.lastSeenAt,
              lastTelemetryAt: null,
              sensors: updatedSensors,
            },
          };
        }
        return {
          ...prev,
          [packet.deviceMqttId]: {
            ...existing,
            status: packet.status,
            lastSeenAt: packet.lastSeenAt,
            sensors: updatedSensors,
          },
        };
      });
    };

    const handleConnect = () => {
      subscribedGreenhouses.current.forEach((ghId) => {
        socketManager.subscribeGreenhouse(ghId);
      });
    };

    socket.on('connect', handleConnect);
    socket.on('telemetry:update', handleTelemetry);
    socket.on('telemetry:broadcast', handleTelemetry);
    socket.on('status:update', handleStatus);
    socket.on('status:broadcast', handleStatus);
    const handleCommandUpdate = (packet: ActuatorCommandUpdate) => setLatestCommandUpdate(packet);
    socket.on('actuator:command:update', handleCommandUpdate);

    return () => {
      unsubscribeStatus();
      socket.off('connect', handleConnect);
      socket.off('telemetry:update', handleTelemetry);
      socket.off('telemetry:broadcast', handleTelemetry);
      socket.off('status:update', handleStatus);
      socket.off('status:broadcast', handleStatus);
      socket.off('actuator:command:update', handleCommandUpdate);
    };
  }, []);

  const seedDeviceStates = useCallback((states: RealtimeDeviceState[]) => {
    setDeviceStates((prev) => {
      const next = { ...prev };
      for (const s of states) {
        const sensors = { ...s.sensors };
        next[s.deviceMqttId] = {
          ...next[s.deviceMqttId],
          ...s,
          sensors,
        };
      }
      return next;
    });
  }, []);

  const subscribeGreenhouse = useCallback((greenhouseId: string) => {
    subscribedGreenhouses.current.add(greenhouseId);
    socketManager.subscribeGreenhouse(greenhouseId);
  }, []);

  const unsubscribeGreenhouse = useCallback((greenhouseId: string) => {
    subscribedGreenhouses.current.delete(greenhouseId);
    socketManager.unsubscribeGreenhouse(greenhouseId);
  }, []);

  const subscribeDevice = useCallback((deviceMqttId: string) => {
    socketManager.subscribeDevice(deviceMqttId);
  }, []);

  const getDeviceState = useCallback(
    (deviceMqttId: string) => {
      return deviceStates[deviceMqttId];
    },
    [deviceStates],
  );

  return (
    <SocketContext.Provider
      value={{
        status,
        deviceStates,
        lastUpdate,
        latestTelemetry,
        latestCommandUpdate,
        subscribeGreenhouse,
        unsubscribeGreenhouse,
        subscribeDevice,
        seedDeviceStates,
        getDeviceState,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
}

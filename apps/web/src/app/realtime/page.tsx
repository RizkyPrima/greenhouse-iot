'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/context/auth-context';
import { useSocket } from '@/context/socket-context';
import { ConnectionBadge } from '@/components/common/status-badge';
import { Actuator } from '@/types';
import {
  Thermometer,
  Droplets,
  Sun,
  Sprout,
  Wind,
  Fan,
  Radio,
  Terminal,
  Layers,
} from 'lucide-react';

interface StreamPacket {
  id: string;
  time: string;
  deviceMqttId: string;
  sensors: Array<{ code: string; value: number; unit?: string }>;
  seq?: number;
  source: 'LIVE' | 'CACHE';
}

const EMPTY_ACTUATOR_STATES: Array<{ actuatorId: string; activeState: boolean; updatedAt: string }> = [];

export default function RealtimePage() {
  const { currentOrg, hasRole } = useAuth();
  const { status, deviceStates, lastUpdate, latestTelemetry, latestCommandUpdate, subscribeGreenhouse, unsubscribeGreenhouse, seedDeviceStates } = useSocket();

  // Fetch all greenhouses in the current organization
  const { data: greenhouses = [] } = useQuery({
    queryKey: ['greenhouses', currentOrg?.id],
    queryFn: () => apiClient.getGreenhouses(currentOrg?.id),
  });
  const { data: registeredDevices = [] } = useQuery({
    queryKey: ['devices', currentOrg?.id],
    queryFn: () => apiClient.getDevices(currentOrg?.id),
  });
  const { data: allActuators = [], refetch: refetchActuators } = useQuery({
    queryKey: ['actuators', currentOrg?.id],
    queryFn: () => apiClient.getActuators(),
    enabled: !!currentOrg,
  });
  const { data: persistedActuatorStates = EMPTY_ACTUATOR_STATES } = useQuery({
    queryKey: ['actuator-states', currentOrg?.id],
    queryFn: () => apiClient.getLatestActuatorStates(),
    enabled: !!currentOrg,
  });

  const [selectedGreenhouseId, setSelectedGreenhouseId] = useState<string>('');
  const [streamLog, setStreamLog] = useState<StreamPacket[]>([]);
  const [now, setNow] = useState(Date.now());
  const [actuatorStates, setActuatorStates] = useState<Record<string, boolean>>({});
  const [pendingActuators, setPendingActuators] = useState<Record<string, boolean>>({});
  const [commandMessage, setCommandMessage] = useState<string | null>(null);
  const canControl = hasRole('OWNER', 'ADMIN', 'OPERATOR');

  useEffect(() => {
    if (persistedActuatorStates.length === 0) return;

    setActuatorStates((previous) => {
      let changed = false;
      const next = { ...previous };

      for (const state of persistedActuatorStates) {
        if (next[state.actuatorId] !== state.activeState) {
          next[state.actuatorId] = state.activeState;
          changed = true;
        }
      }

      return changed ? next : previous;
    });
  }, [persistedActuatorStates]);

  useEffect(() => {
    if (!latestCommandUpdate?.actuatorId) return;
    setPendingActuators((prev) => ({ ...prev, [latestCommandUpdate.actuatorId!]: false }));
    if (latestCommandUpdate.status === 'EXECUTED' && typeof latestCommandUpdate.result?.activeState === 'boolean') {
      setActuatorStates((prev) => ({ ...prev, [latestCommandUpdate.actuatorId!]: latestCommandUpdate.result!.activeState! }));
      setCommandMessage(`Actuator ${latestCommandUpdate.target} ${latestCommandUpdate.result.activeState ? 'ON' : 'OFF'} dikonfirmasi perangkat.`);
    } else {
      setCommandMessage(latestCommandUpdate.error || `Command ${latestCommandUpdate.status.toLowerCase()}.`);
    }
    void refetchActuators();
  }, [latestCommandUpdate, refetchActuators]);

  const sendActuatorCommand = async (actuator: Actuator, command: 'ON' | 'OFF') => {
    setPendingActuators((prev) => ({ ...prev, [actuator.id]: true }));
    setCommandMessage(`Mengirim ${command} ke ${actuator.name}…`);
    try {
      const sent = await apiClient.sendActuatorCommand(actuator.id, command);
      setCommandMessage(`Command ${command} terkirim; menunggu konfirmasi ESP32.`);
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const current = await apiClient.getActuatorCommand(sent.commandId);
        if (current.status === 'PENDING' || current.status === 'SENT' || current.status === 'ACKNOWLEDGED') continue;

        setPendingActuators((prev) => ({ ...prev, [actuator.id]: false }));
        if (current.status === 'EXECUTED' && typeof current.result?.activeState === 'boolean') {
          setActuatorStates((prev) => ({ ...prev, [actuator.id]: current.result!.activeState! }));
          setCommandMessage(`Actuator ${actuator.name} ${current.result.activeState ? 'ON' : 'OFF'} dikonfirmasi perangkat.`);
        } else {
          setCommandMessage(current.error || `Command ${current.status.toLowerCase()}.`);
        }
        return;
      }
      setPendingActuators((prev) => ({ ...prev, [actuator.id]: false }));
      setCommandMessage('Status command belum tersedia. Periksa koneksi API dan database.');
    } catch (error) {
      setPendingActuators((prev) => ({ ...prev, [actuator.id]: false }));
      setCommandMessage(error instanceof Error ? error.message : 'Gagal mengirim command.');
    }
  };

  // Periodic heartbeat timer to detect 30s offline threshold dynamically
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(timer);
  }, []);

  // Automatically select first greenhouse
  useEffect(() => {
    if (greenhouses.length > 0 && !selectedGreenhouseId) {
      setSelectedGreenhouseId(greenhouses[0].id);
    }
  }, [greenhouses, selectedGreenhouseId]);

  // Subscribe to selected greenhouse on WebSocket and fetch seed state from Redis
  useEffect(() => {
    if (!selectedGreenhouseId) return;

    const greenhouseCode = greenhouses.find((greenhouse) => greenhouse.id === selectedGreenhouseId)?.code;
    if (!greenhouseCode) return;

    subscribeGreenhouse(greenhouseCode);

    const greenhouseDevices = registeredDevices.filter((device) => device.greenhouseId === selectedGreenhouseId);
    void Promise.all(greenhouseDevices.map((device) => apiClient.getDeviceRealtime(device.deviceId)))
      .then((responses) => seedDeviceStates(responses.flatMap((response) => response.data ? [response.data] : [])))
      .catch(() => {});

    // Fetch instant snapshot from Redis (NO Postgres polling)
    void apiClient
      .getGreenhouseRealtime(greenhouseCode)
      .then((res) => {
        if (res.devices) {
          seedDeviceStates(res.devices);
          const cachedPackets = res.devices.flatMap((device) => {
            const sensors = Object.values(device.sensors ?? {}).flatMap((sensor) =>
              typeof sensor.numericValue === 'number'
                ? [{ code: sensor.sensorCode, value: sensor.numericValue, unit: sensor.unit ?? undefined }]
                : [],
            );
            if (sensors.length === 0) return [];
            const timestamp = device.lastTelemetryAt ?? device.lastSeenAt ?? new Date().toISOString();
            return [{
              id: `cache-${device.deviceMqttId}-${timestamp}`,
              time: new Date(timestamp).toLocaleTimeString(),
              deviceMqttId: device.deviceMqttId,
              sensors,
              seq: device.sequence,
              source: 'CACHE' as const,
            }];
          });
          setStreamLog((current) => current.length > 0 ? current : cachedPackets.slice(0, 20));
        }
      })
      .catch(() => {});

    return () => {
      unsubscribeGreenhouse(greenhouseCode);
    };
  }, [selectedGreenhouseId, greenhouses, registeredDevices, subscribeGreenhouse, unsubscribeGreenhouse, seedDeviceStates]);

  // Track stream updates into a live terminal log
  useEffect(() => {
    if (!latestTelemetry?.payload?.sensors?.length) return;

    const sensorList = latestTelemetry.payload.sensors.map((sensor) => ({
      code: sensor.code,
      value: sensor.value,
      unit: sensor.unit,
    }));

    if (sensorList.length > 0) {
      const newPacket: StreamPacket = {
        id: `${Date.now()}-${Math.random()}`,
        time: new Date().toLocaleTimeString(),
        deviceMqttId: latestTelemetry.deviceMqttId,
        sensors: sensorList,
        seq: latestTelemetry.payload.seq,
        source: 'LIVE',
      };

      setStreamLog((prev) => [newPacket, ...prev.slice(0, 19)]);
    }
  }, [latestTelemetry]);

  const selectedGH = greenhouses.find((g) => g.id === selectedGreenhouseId);

  // Devices belonging to this greenhouse
  const currentDevices = useMemo(() => {
    const greenhouseDevices = registeredDevices.filter((device) => device.greenhouseId === selectedGreenhouseId);
    return greenhouseDevices.map((device) => {
      const live = deviceStates[device.deviceId];
      const timestamps = [device.lastSeenAt, live?.lastSeenAt].filter((value): value is string => Boolean(value));
      const lastSeenAt = timestamps.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
      return {
        ...(live ?? {
          deviceMqttId: device.deviceId,
          greenhouseId: selectedGH?.code ?? '',
          status: device.status,
          lastTelemetryAt: null,
          sensors: {},
        }),
        // The registered-device heartbeat is also refreshed by backend MQTT
        // ingestion, and avoids stale Redis metadata masking a recent heartbeat.
        lastSeenAt,
      };
    });
  }, [deviceStates, registeredDevices, selectedGreenhouseId, selectedGH]);

  // Online / active controllers (<= 30s heartbeat window)
  const onlineControllers = useMemo(() => {
    return currentDevices.filter((dev) => {
      if (!dev.lastSeenAt) return false;
      const diffSecs = (now - new Date(dev.lastSeenAt).getTime()) / 1000;
      return diffSecs <= 30;
    });
  }, [currentDevices, now]);

  const isAllOffline = currentDevices.length === 0 || onlineControllers.length === 0;

  // Aggregate sensor readings across current devices (Zero out when device is offline)
  const sensorMap = useMemo(() => {
    const map: Record<string, { code: string; label: string; value: number | null; unit: string; deviceMqttId: string; timestamp: string }> = {
      temp_air: { code: 'temp_air', label: 'Air Temperature', value: 0, unit: '°C', deviceMqttId: '--', timestamp: '--' },
      humidity: { code: 'humidity', label: 'Air Humidity', value: 0, unit: '%', deviceMqttId: '--', timestamp: '--' },
      soil_moisture: { code: 'soil_moisture', label: 'Soil Moisture', value: 0, unit: '%', deviceMqttId: '--', timestamp: '--' },
      light_intensity: { code: 'light_intensity', label: 'Solar Radiation / Light', value: 0, unit: 'Lux', deviceMqttId: '--', timestamp: '--' },
      co2: { code: 'co2', label: 'CO2 Concentration', value: 0, unit: 'ppm', deviceMqttId: '--', timestamp: '--' },
      temp_soil: { code: 'temp_soil', label: 'Soil Substrate Temp', value: 0, unit: '°C', deviceMqttId: '--', timestamp: '--' },
    };

    if (isAllOffline) {
      // When all controllers are offline, sensors are unreachable: all values = 0
      return map;
    }

    for (const dev of currentDevices) {
      const isDevOffline = (() => {
        if (!dev.lastSeenAt) return true;
        const diffSecs = (now - new Date(dev.lastSeenAt).getTime()) / 1000;
        return diffSecs > 30;
      })();

      if (dev.sensors) {
        for (const [code, s] of Object.entries(dev.sensors)) {
          if (typeof s.numericValue === 'number') {
            const lower = code.toLowerCase();
            let key = lower;
            if (lower.includes('temp') && !lower.includes('soil')) key = 'temp_air';
            else if (lower.includes('hum')) key = 'humidity';
            else if (lower.includes('soil') && lower.includes('temp')) key = 'temp_soil';
            else if (lower.includes('soil') || lower.includes('moist')) key = 'soil_moisture';
            else if (lower.includes('light') || lower.includes('lux')) key = 'light_intensity';
            else if (lower.includes('co2')) key = 'co2';

            const effectiveVal = isDevOffline ? 0 : s.numericValue;

            if (!map[key]) {
              map[key] = {
                code,
                label: code.replace(/_/g, ' ').toUpperCase(),
                value: effectiveVal,
                unit: s.unit || '',
                deviceMqttId: dev.deviceMqttId,
                timestamp: s.timestamp,
              };
            } else {
              if (!isDevOffline || map[key].value === 0 || map[key].value === null) {
                map[key].value = effectiveVal;
                if (s.unit) map[key].unit = s.unit;
                map[key].deviceMqttId = dev.deviceMqttId;
                map[key].timestamp = s.timestamp;
              }
            }
          }
        }
      }
    }

    return map;
  }, [currentDevices, isAllOffline, now]);

  const greenhouseDeviceIds = new Set(registeredDevices
    .filter((device) => device.greenhouseId === selectedGreenhouseId)
    .map((device) => device.id));
  const actuators = allActuators.filter((actuator) => greenhouseDeviceIds.has(actuator.deviceId));

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Top bar with Facility Selector & Realtime Indicator */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-white font-mono">
                REALTIME TELEMETRY FEED
              </h1>
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1 font-mono">
              Live WebSocket Stream: NestJS Gateway · Redis Cache · Zero DB Polling
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Greenhouse selector */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-800 bg-slate-900/80">
              <Layers className="h-4 w-4 text-emerald-400" />
              <select
                value={selectedGreenhouseId}
                onChange={(e) => setSelectedGreenhouseId(e.target.value)}
                className="bg-transparent text-xs font-semibold text-slate-100 pr-4 focus:outline-none cursor-pointer"
              >
                {greenhouses.map((gh) => (
                  <option key={gh.id} value={gh.id} className="bg-slate-900 text-slate-100">
                    {gh.name} ({gh.code})
                  </option>
                ))}
              </select>
            </div>

            <ConnectionBadge status={status} labelPrefix="LIVE FEED" />
          </div>
        </div>

        {/* Realtime Stream Status Bar */}
        <div className={`p-4 rounded-2xl border backdrop-blur-md flex flex-wrap items-center justify-between gap-4 text-xs font-mono transition-colors ${
          isAllOffline
            ? 'border-rose-500/30 bg-rose-950/20'
            : 'border-slate-800/80 bg-slate-900/60'
        }`}>
          <div className="flex items-center gap-3">
            <Radio className={`h-4 w-4 animate-pulse ${isAllOffline ? 'text-rose-400' : 'text-emerald-400'}`} />
            <span className="text-slate-300">Active Room:</span>
            <span className={`font-bold ${isAllOffline ? 'text-rose-400' : 'text-emerald-400'}`}>
              greenhouse:{selectedGH?.code ?? selectedGreenhouseId}
            </span>
            {isAllOffline && (
              <span className="px-2 py-0.5 rounded-full bg-rose-950/60 border border-rose-500/40 text-rose-400 font-bold tracking-widest">
                ALL NODES OFFLINE
              </span>
            )}
          </div>

          <div className="flex items-center gap-6 text-slate-400">
            <div>
              <span>Online Controllers: </span>
              <span className={`font-semibold ${onlineControllers.length > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {onlineControllers.length}/{currentDevices.length}
              </span>
            </div>
            <div>
              <span>Last Packet: </span>
              <span className="text-slate-100 font-semibold">
                {lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : 'Awaiting...'}
              </span>
            </div>
          </div>
        </div>

        {/* Section 1: Live Environmental Sensors */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Thermometer className="h-4 w-4 text-emerald-400" />
              <span>Sensors Telemetry Matrix</span>
            </h2>
            <span className="text-[11px] font-mono text-slate-500">
              {isAllOffline ? '⚠ Sensor data unavailable — no active node' : 'Live ESP32 sensor values'}
            </span>
          </div>

          {/* Offline banner */}
          {isAllOffline && (
            <div className="mb-4 p-3 rounded-xl border border-rose-500/30 bg-rose-950/20 flex items-center gap-3 text-xs font-mono">
              <span className="text-rose-400 text-base">⚠</span>
              <span className="text-rose-300 font-semibold">Semua node ESP32 offline — sensor tidak terbaca.</span>
              <span className="text-slate-400">Seluruh nilai sensor ditampilkan sebagai 0 (data tidak valid).</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Air Temperature */}
            <div className={`p-5 rounded-2xl border backdrop-blur-md relative overflow-hidden shadow-lg transition-colors ${
              isAllOffline ? 'border-rose-500/10 bg-slate-900/40 opacity-60' : 'border-emerald-500/20 bg-slate-900/70'
            }`}>
              {isAllOffline && (
                <span className="absolute top-2 right-2 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-rose-950/80 border border-rose-500/40 text-rose-400">NO DATA</span>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  {sensorMap.temp_air.label}
                </span>
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
                  <Thermometer className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className={`text-4xl font-extrabold font-mono tracking-tight ${isAllOffline ? 'text-slate-500' : 'text-white'}`}>
                  {(sensorMap.temp_air.value ?? 0).toFixed(1)}
                </span>
                <span className="text-lg font-semibold text-slate-400 font-mono">°C</span>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-500">
                <span>Node: {sensorMap.temp_air.deviceMqttId}</span>
                <span className={isAllOffline ? 'text-rose-500' : 'text-emerald-400'}>{isAllOffline ? 'OFFLINE' : 'OPTIMAL (22-28°C)'}</span>
              </div>
            </div>

            {/* Air Humidity */}
            <div className={`p-5 rounded-2xl border backdrop-blur-md relative overflow-hidden shadow-lg transition-colors ${
              isAllOffline ? 'border-rose-500/10 bg-slate-900/40 opacity-60' : 'border-cyan-500/20 bg-slate-900/70'
            }`}>
              {isAllOffline && (
                <span className="absolute top-2 right-2 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-rose-950/80 border border-rose-500/40 text-rose-400">NO DATA</span>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  {sensorMap.humidity.label}
                </span>
                <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
                  <Droplets className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className={`text-4xl font-extrabold font-mono tracking-tight ${isAllOffline ? 'text-slate-500' : 'text-white'}`}>
                  {(sensorMap.humidity.value ?? 0).toFixed(1)}
                </span>
                <span className="text-lg font-semibold text-slate-400 font-mono">%</span>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-500">
                <span>Node: {sensorMap.humidity.deviceMqttId}</span>
                <span className={isAllOffline ? 'text-rose-500' : 'text-cyan-400'}>{isAllOffline ? 'OFFLINE' : 'RH (60-80%)'}</span>
              </div>
            </div>

            {/* Soil Moisture */}
            <div className={`p-5 rounded-2xl border backdrop-blur-md relative overflow-hidden shadow-lg transition-colors ${
              isAllOffline ? 'border-rose-500/10 bg-slate-900/40 opacity-60' : 'border-emerald-500/20 bg-slate-900/70'
            }`}>
              {isAllOffline && (
                <span className="absolute top-2 right-2 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-rose-950/80 border border-rose-500/40 text-rose-400">NO DATA</span>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  {sensorMap.soil_moisture.label}
                </span>
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
                  <Sprout className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className={`text-4xl font-extrabold font-mono tracking-tight ${isAllOffline ? 'text-slate-500' : 'text-white'}`}>
                  {(sensorMap.soil_moisture.value ?? 0).toFixed(1)}
                </span>
                <span className="text-lg font-semibold text-slate-400 font-mono">%</span>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-500">
                <span>Node: {sensorMap.soil_moisture.deviceMqttId}</span>
                <span className={isAllOffline ? 'text-rose-500' : 'text-emerald-400'}>{isAllOffline ? 'OFFLINE' : 'HYDRATED'}</span>
              </div>
            </div>

            {/* Solar Radiation / Light */}
            <div className={`p-5 rounded-2xl border backdrop-blur-md relative overflow-hidden shadow-lg transition-colors ${
              isAllOffline ? 'border-rose-500/10 bg-slate-900/40 opacity-60' : 'border-amber-500/20 bg-slate-900/70'
            }`}>
              {isAllOffline && (
                <span className="absolute top-2 right-2 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-rose-950/80 border border-rose-500/40 text-rose-400">NO DATA</span>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  {sensorMap.light_intensity.label}
                </span>
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
                  <Sun className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className={`text-4xl font-extrabold font-mono tracking-tight ${isAllOffline ? 'text-slate-500' : 'text-white'}`}>
                  {Math.round(sensorMap.light_intensity.value ?? 0)}
                </span>
                <span className="text-lg font-semibold text-slate-400 font-mono">Lux</span>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-500">
                <span>Node: {sensorMap.light_intensity.deviceMqttId}</span>
                <span className={isAllOffline ? 'text-rose-500' : 'text-slate-400'}>{isAllOffline ? 'OFFLINE' : 'PAR Spectrum'}</span>
              </div>
            </div>

            {/* CO2 Concentration */}
            <div className={`p-5 rounded-2xl border backdrop-blur-md relative overflow-hidden shadow-lg transition-colors ${
              isAllOffline ? 'border-rose-500/10 bg-slate-900/40 opacity-60' : 'border-indigo-500/20 bg-slate-900/70'
            }`}>
              {isAllOffline && (
                <span className="absolute top-2 right-2 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-rose-950/80 border border-rose-500/40 text-rose-400">NO DATA</span>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  {sensorMap.co2.label}
                </span>
                <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400">
                  <Wind className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className={`text-4xl font-extrabold font-mono tracking-tight ${isAllOffline ? 'text-slate-500' : 'text-white'}`}>
                  {Math.round(sensorMap.co2.value ?? 0)}
                </span>
                <span className="text-lg font-semibold text-slate-400 font-mono">ppm</span>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-500">
                <span>Node: {sensorMap.co2.deviceMqttId}</span>
                <span className={isAllOffline ? 'text-rose-500' : 'text-slate-400'}>{isAllOffline ? 'OFFLINE' : 'Photosynthesis Level'}</span>
              </div>
            </div>

            {/* Soil Temperature */}
            <div className={`p-5 rounded-2xl border backdrop-blur-md relative overflow-hidden shadow-lg transition-colors ${
              isAllOffline ? 'border-rose-500/10 bg-slate-900/40 opacity-60' : 'border-slate-800 bg-slate-900/70'
            }`}>
              {isAllOffline && (
                <span className="absolute top-2 right-2 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-rose-950/80 border border-rose-500/40 text-rose-400">NO DATA</span>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  {sensorMap.temp_soil.label}
                </span>
                <div className="p-2 rounded-xl bg-slate-800 text-slate-300">
                  <Thermometer className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className={`text-4xl font-extrabold font-mono tracking-tight ${isAllOffline ? 'text-slate-500' : 'text-white'}`}>
                  {(sensorMap.temp_soil.value ?? 0).toFixed(1)}
                </span>
                <span className="text-lg font-semibold text-slate-400 font-mono">°C</span>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-500">
                <span>Node: {sensorMap.temp_soil.deviceMqttId}</span>
                <span className={isAllOffline ? 'text-rose-500' : 'text-slate-400'}>{isAllOffline ? 'OFFLINE' : 'Root Zone'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Actuators Live States */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Fan className="h-4 w-4 text-emerald-400" />
              <span>Actuators Operational Status</span>
            </h2>
            <span className="text-[11px] font-mono text-slate-500">Control loops & motor drives</span>
          </div>

          {commandMessage && <p role="status" aria-live="polite" className="mb-3 text-xs font-mono text-slate-300">{commandMessage}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {actuators.map((act) => {
              const normalizedCode = act.code.toLowerCase();
              const supported = ['pump', 'pompa', 'fan', 'kipas', 'light', 'lampu'].includes(normalizedCode);
              const device = registeredDevices.find((item) => item.id === act.deviceId);
              const deviceOnline = !!device && onlineControllers.some((item) => item.deviceMqttId === device.deviceId);
              const isPending = !!pendingActuators[act.id];
              const isRunning = actuatorStates[act.id];
              const Icon = normalizedCode.includes('pump') || normalizedCode.includes('pompa') ? Droplets
                : normalizedCode.includes('light') || normalizedCode.includes('lampu') ? Sun : Fan;
              return (
                <div
                  key={act.id}
                  className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 text-white"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-2 rounded-lg bg-slate-800 text-emerald-400"><Icon className="h-4 w-4" /></div>
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border border-slate-700 text-slate-300">
                      {isPending ? 'WAITING ACK' : isRunning === undefined ? 'STATE UNKNOWN' : isRunning ? 'ON' : 'OFF'}
                    </span>
                  </div>

                  <h3 className="text-xs font-semibold text-slate-200 block truncate">{act.name}</h3>
                  <p className="mt-1 text-[10px] font-mono text-slate-500">Device: {device?.deviceId ?? 'unknown'} · {deviceOnline ? 'ONLINE' : 'OFFLINE'}</p>
                  <div className="mt-3 flex gap-2">
                    {(['ON', 'OFF'] as const).map((command) => {
                      const isSelected = isRunning !== undefined && isRunning === (command === 'ON');
                      const isAlreadyAtTarget = isSelected && !isPending;
                      const stateClass = isSelected
                        ? command === 'ON'
                          ? 'bg-emerald-500 text-white ring-2 ring-emerald-300 shadow-lg shadow-emerald-950/50'
                          : 'bg-rose-500 text-white ring-2 ring-rose-300 shadow-lg shadow-rose-950/50'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700';
                      const reason = !canControl
                        ? 'Role tidak memiliki izin kontrol'
                        : !act.enabled
                          ? 'Actuator dinonaktifkan'
                          : !supported
                            ? 'Actuator ini belum didukung firmware'
                            : !deviceOnline
                              ? 'Perangkat offline'
                              : isPending
                                ? 'Menunggu konfirmasi perangkat'
                                : isAlreadyAtTarget
                                  ? `Aktuator sudah ${command}`
                                  : undefined;

                      return (
                        <button
                          key={command}
                          type="button"
                          onClick={() => void sendActuatorCommand(act, command)}
                          disabled={!canControl || !act.enabled || !supported || !deviceOnline || isPending || isAlreadyAtTarget}
                          className={`flex-1 rounded-lg px-3 py-2 text-xs font-mono font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${stateClass}`}
                          title={reason}
                          aria-pressed={isSelected}
                        >
                          {isPending ? '…' : isSelected ? `${command} ✓` : command}
                        </button>
                      );
                    })}
                  </div>
                  {!supported && <p className="mt-2 text-[10px] text-amber-400">Firmware saat ini hanya mendukung pump, fan, light.</p>}
                  {!canControl && <p className="mt-2 text-[10px] text-rose-400">Role Anda tidak dapat mengendalikan actuator.</p>}
                </div>
              );
            })}
            {actuators.length === 0 && <p className="col-span-full rounded-xl border border-dashed border-slate-700 p-6 text-center text-xs text-slate-400">Belum ada actuator terdaftar di greenhouse ini.</p>}
          </div>
        </div>

        {/* Section 3: Live Ingestion Stream Terminal */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-2xl">
          <div className="flex items-center justify-between mb-3 pb-3 border-b border-slate-800/80">
            <div className="flex items-center gap-2 font-mono text-xs text-slate-300">
              <Terminal className="h-4 w-4 text-emerald-400" />
              <span>LIVE INGESTION STREAM (ESP32-S3 → MQTT → NESTJS → WEBSOCKET)</span>
            </div>
            <div className="flex items-center gap-3 text-[11px] font-mono">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 ${status === 'CONNECTED' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600' : 'border-amber-500/40 bg-amber-500/10 text-amber-700'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${status === 'CONNECTED' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                WS {status}
              </span>
              <span className="text-slate-500">{streamLog.length} packets in memory</span>
            </div>
          </div>

          {streamLog.length === 0 ? (
            <div className="p-8 text-center font-mono text-xs text-slate-500">
              Waiting for incoming WebSocket telemetry packets from active edge nodes...
            </div>
          ) : (
            <div className="space-y-1.5 font-mono text-[11px] max-h-56 overflow-y-auto pr-2">
              {streamLog.map((packet) => (
                <div
                  key={packet.id}
                  className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/80 flex flex-wrap items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-slate-500">[{packet.time}]</span>
                    <span className="text-emerald-400 font-semibold">{packet.deviceMqttId}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${packet.source === 'LIVE' ? 'bg-emerald-500/15 text-emerald-700' : 'bg-amber-500/15 text-amber-700'}`}>
                      {packet.source}
                    </span>
                    {packet.seq !== undefined && (
                      <span className="text-slate-500">seq={packet.seq}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {packet.sensors.map((s, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded bg-slate-800/90 text-slate-300 border border-slate-700/60"
                      >
                        {s.code}: <strong className="text-white">{s.value}</strong> {s.unit || ''}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/context/auth-context';
import { useSocket } from '@/context/socket-context';
import { ConnectionBadge } from '@/components/common/status-badge';
import {
  Thermometer,
  Droplets,
  Sun,
  Sprout,
  Wind,
  Fan,
  Pipette,
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
}

export default function RealtimePage() {
  const { currentOrg } = useAuth();
  const { status, deviceStates, lastUpdate, subscribeGreenhouse, unsubscribeGreenhouse, seedDeviceStates } = useSocket();

  // Fetch all greenhouses in the current organization
  const { data: greenhouses = [] } = useQuery({
    queryKey: ['greenhouses', currentOrg?.id],
    queryFn: () => apiClient.getGreenhouses(),
  });

  const [selectedGreenhouseId, setSelectedGreenhouseId] = useState<string>('');
  const [streamLog, setStreamLog] = useState<StreamPacket[]>([]);

  // Automatically select first greenhouse
  useEffect(() => {
    if (greenhouses.length > 0 && !selectedGreenhouseId) {
      setSelectedGreenhouseId(greenhouses[0].id);
    }
  }, [greenhouses, selectedGreenhouseId]);

  // Subscribe to selected greenhouse on WebSocket and fetch seed state from Redis
  useEffect(() => {
    if (!selectedGreenhouseId) return;

    subscribeGreenhouse(selectedGreenhouseId);

    // Fetch instant snapshot from Redis (NO Postgres polling)
    void apiClient
      .getGreenhouseRealtime(selectedGreenhouseId)
      .then((res) => {
        if (res.devices) {
          seedDeviceStates(res.devices);
        }
      })
      .catch(() => {});

    return () => {
      unsubscribeGreenhouse(selectedGreenhouseId);
    };
  }, [selectedGreenhouseId, subscribeGreenhouse, unsubscribeGreenhouse, seedDeviceStates]);

  // Track stream updates into a live terminal log
  useEffect(() => {
    if (!lastUpdate) return;

    // Pick latest updated device
    const entries = Object.values(deviceStates);
    if (entries.length === 0) return;

    const latest = entries[entries.length - 1];
    const sensorList = Object.values(latest.sensors).map((s) => ({
      code: s.sensorCode,
      value: s.numericValue ?? 0,
      unit: s.unit ?? undefined,
    }));

    if (sensorList.length > 0) {
      const newPacket: StreamPacket = {
        id: `${Date.now()}-${Math.random()}`,
        time: new Date().toLocaleTimeString(),
        deviceMqttId: latest.deviceMqttId,
        sensors: sensorList,
        seq: latest.sequence,
      };

      setStreamLog((prev) => [newPacket, ...prev.slice(0, 19)]);
    }
  }, [lastUpdate, deviceStates]);

  // Devices belonging to this greenhouse
  const currentDevices = useMemo(() => {
    return Object.values(deviceStates).filter(
      (d) => !selectedGreenhouseId || d.greenhouseId === selectedGreenhouseId,
    );
  }, [deviceStates, selectedGreenhouseId]);

  // Aggregate sensor readings across current devices
  const sensorMap = useMemo(() => {
    const map: Record<string, { code: string; label: string; value: number | null; unit: string; deviceMqttId: string; timestamp: string }> = {
      temp_air: { code: 'temp_air', label: 'Air Temperature', value: null, unit: '°C', deviceMqttId: '--', timestamp: '--' },
      humidity: { code: 'humidity', label: 'Air Humidity', value: null, unit: '%', deviceMqttId: '--', timestamp: '--' },
      soil_moisture: { code: 'soil_moisture', label: 'Soil Moisture', value: null, unit: '%', deviceMqttId: '--', timestamp: '--' },
      light_intensity: { code: 'light_intensity', label: 'Solar Radiation / Light', value: null, unit: 'Lux', deviceMqttId: '--', timestamp: '--' },
      co2: { code: 'co2', label: 'CO2 Concentration', value: null, unit: 'ppm', deviceMqttId: '--', timestamp: '--' },
      temp_soil: { code: 'temp_soil', label: 'Soil Substrate Temp', value: null, unit: '°C', deviceMqttId: '--', timestamp: '--' },
    };

    for (const dev of currentDevices) {
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

            if (!map[key]) {
              map[key] = {
                code,
                label: code.replace(/_/g, ' ').toUpperCase(),
                value: s.numericValue,
                unit: s.unit || '',
                deviceMqttId: dev.deviceMqttId,
                timestamp: s.timestamp,
              };
            } else {
              map[key].value = s.numericValue;
              if (s.unit) map[key].unit = s.unit;
              map[key].deviceMqttId = dev.deviceMqttId;
              map[key].timestamp = s.timestamp;
            }
          }
        }
      }
    }

    return map;
  }, [currentDevices]);

  // Actuator list defined in scope
  const actuators = [
    { code: 'fan', name: 'Exhaust & Circulation Fan', type: 'FAN', active: true, icon: Fan, speed: '900 RPM' },
    { code: 'pump', name: 'Main Irrigation Pump', type: 'PUMP', active: false, icon: Pipette, speed: 'Standby' },
    { code: 'valve', name: 'Zone Water Solenoid Valve', type: 'VALVE', active: true, icon: Droplets, speed: 'Open' },
    { code: 'vent', name: 'Roof Ventilation Motors', type: 'VENT', active: true, icon: Wind, speed: '45% Pitch' },
    { code: 'fertigation', name: 'Fertigation Nutrient Dosing', type: 'FERTIGATION', active: false, icon: Sprout, speed: 'Off' },
  ];

  const selectedGH = greenhouses.find((g) => g.id === selectedGreenhouseId);

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

            <ConnectionBadge status={status} />
          </div>
        </div>

        {/* Realtime Stream Status Bar */}
        <div className="p-4 rounded-2xl border border-slate-800/80 bg-slate-900/60 backdrop-blur-md flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
          <div className="flex items-center gap-3">
            <Radio className="h-4 w-4 text-emerald-400 animate-pulse" />
            <span className="text-slate-300">Active Room:</span>
            <span className="text-emerald-400 font-bold">
              greenhouse:{selectedGH?.code ?? selectedGreenhouseId}
            </span>
          </div>

          <div className="flex items-center gap-6 text-slate-400">
            <div>
              <span>Connected Controllers: </span>
              <span className="text-slate-100 font-semibold">{currentDevices.length}</span>
            </div>
            <div>
              <span>Last Packet Received: </span>
              <span className="text-slate-100 font-semibold">
                {lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : 'Awaiting packets...'}
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
            <span className="text-[11px] font-mono text-slate-500">Live ESP32 sensor values</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Air Temperature */}
            <div className="p-5 rounded-2xl border border-emerald-500/20 bg-slate-900/70 backdrop-blur-md relative overflow-hidden shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  {sensorMap.temp_air.label}
                </span>
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
                  <Thermometer className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-4xl font-extrabold text-white font-mono tracking-tight">
                  {sensorMap.temp_air.value !== null ? sensorMap.temp_air.value.toFixed(1) : '--'}
                </span>
                <span className="text-lg font-semibold text-slate-400 font-mono">°C</span>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-500">
                <span>Node: {sensorMap.temp_air.deviceMqttId}</span>
                <span className="text-emerald-400">OPTIMAL (22-28°C)</span>
              </div>
            </div>

            {/* Air Humidity */}
            <div className="p-5 rounded-2xl border border-cyan-500/20 bg-slate-900/70 backdrop-blur-md relative overflow-hidden shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  {sensorMap.humidity.label}
                </span>
                <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
                  <Droplets className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-4xl font-extrabold text-white font-mono tracking-tight">
                  {sensorMap.humidity.value !== null ? sensorMap.humidity.value.toFixed(1) : '--'}
                </span>
                <span className="text-lg font-semibold text-slate-400 font-mono">%</span>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-500">
                <span>Node: {sensorMap.humidity.deviceMqttId}</span>
                <span className="text-cyan-400">RH (60-80%)</span>
              </div>
            </div>

            {/* Soil Moisture */}
            <div className="p-5 rounded-2xl border border-emerald-500/20 bg-slate-900/70 backdrop-blur-md relative overflow-hidden shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  {sensorMap.soil_moisture.label}
                </span>
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
                  <Sprout className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-4xl font-extrabold text-white font-mono tracking-tight">
                  {sensorMap.soil_moisture.value !== null ? sensorMap.soil_moisture.value.toFixed(1) : '--'}
                </span>
                <span className="text-lg font-semibold text-slate-400 font-mono">%</span>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-500">
                <span>Node: {sensorMap.soil_moisture.deviceMqttId}</span>
                <span className="text-emerald-400">HYDRATED</span>
              </div>
            </div>

            {/* Solar Radiation / Light */}
            <div className="p-5 rounded-2xl border border-amber-500/20 bg-slate-900/70 backdrop-blur-md relative overflow-hidden shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  {sensorMap.light_intensity.label}
                </span>
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
                  <Sun className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-4xl font-extrabold text-white font-mono tracking-tight">
                  {sensorMap.light_intensity.value !== null ? Math.round(sensorMap.light_intensity.value) : '--'}
                </span>
                <span className="text-lg font-semibold text-slate-400 font-mono">Lux</span>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-500">
                <span>Node: {sensorMap.light_intensity.deviceMqttId}</span>
                <span className="text-slate-400">PAR Spectrum</span>
              </div>
            </div>

            {/* CO2 Concentration */}
            <div className="p-5 rounded-2xl border border-indigo-500/20 bg-slate-900/70 backdrop-blur-md relative overflow-hidden shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  {sensorMap.co2.label}
                </span>
                <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400">
                  <Wind className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-4xl font-extrabold text-white font-mono tracking-tight">
                  {sensorMap.co2.value !== null ? Math.round(sensorMap.co2.value) : '--'}
                </span>
                <span className="text-lg font-semibold text-slate-400 font-mono">ppm</span>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-500">
                <span>Node: {sensorMap.co2.deviceMqttId}</span>
                <span className="text-slate-400">Photosynthesis Level</span>
              </div>
            </div>

            {/* Soil Temperature */}
            <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/70 backdrop-blur-md relative overflow-hidden shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  {sensorMap.temp_soil.label}
                </span>
                <div className="p-2 rounded-xl bg-slate-800 text-slate-300">
                  <Thermometer className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-4xl font-extrabold text-white font-mono tracking-tight">
                  {sensorMap.temp_soil.value !== null ? sensorMap.temp_soil.value.toFixed(1) : '--'}
                </span>
                <span className="text-lg font-semibold text-slate-400 font-mono">°C</span>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-500">
                <span>Node: {sensorMap.temp_soil.deviceMqttId}</span>
                <span className="text-slate-400">Root Zone</span>
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

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {actuators.map((act) => {
              const Icon = act.icon;
              return (
                <div
                  key={act.code}
                  className={`p-4 rounded-xl border backdrop-blur-md transition-all ${
                    act.active
                      ? 'border-emerald-500/30 bg-emerald-950/20 text-white'
                      : 'border-slate-800 bg-slate-900/60 text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div
                      className={`p-2 rounded-lg ${
                        act.active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      <Icon className={`h-4 w-4 ${act.active ? 'animate-spin' : ''}`} />
                    </div>
                    <span
                      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                        act.active
                          ? 'bg-emerald-950 text-emerald-400 border-emerald-500/40'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      {act.active ? 'RUNNING' : 'STANDBY'}
                    </span>
                  </div>

                  <h3 className="text-xs font-semibold text-slate-200 block truncate">{act.name}</h3>
                  <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-slate-400">
                    <span>Rate:</span>
                    <span className="text-slate-200 font-semibold">{act.speed}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Section 3: Live Ingestion Stream Terminal */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-2xl">
          <div className="flex items-center justify-between mb-3 pb-3 border-b border-slate-800/80">
            <div className="flex items-center gap-2 font-mono text-xs text-slate-300">
              <Terminal className="h-4 w-4 text-emerald-400" />
              <span>LIVE INGESTION STREAM (ESP32-S3 → MQTT → NESTJS → WEBSOCKET)</span>
            </div>
            <span className="text-[11px] font-mono text-slate-500">
              {streamLog.length} packets in memory
            </span>
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

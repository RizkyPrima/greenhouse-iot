'use client';

import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/context/auth-context';
import { useSocket } from '@/context/socket-context';
import { DeviceStatusBadge } from '@/components/common/status-badge';
import { SkeletonTable, EmptyState } from '@/components/common/empty-state';
import { Device, Sensor, Actuator } from '@/types';
import { Cpu, Activity, Zap, RefreshCw, X } from 'lucide-react';
import { useStatusClock } from '@/hooks/use-status-clock';

export default function DevicesPage() {
  const { currentOrg } = useAuth();
  const { deviceStates, seedDeviceStates, subscribeGreenhouse } = useSocket();
  const now = useStatusClock();
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);

  // Fetch all devices
  const { data: devices = [], isLoading, refetch } = useQuery({
    queryKey: ['devices', currentOrg?.id],
    queryFn: () => apiClient.getDevices(currentOrg?.id),
  });

  // Fetch greenhouses to map names
  const { data: greenhouses = [] } = useQuery({
    queryKey: ['greenhouses', currentOrg?.id],
    queryFn: () => apiClient.getGreenhouses(currentOrg?.id),
  });

  // Hydrate the realtime snapshot when this page is opened; socket events only
  // contain readings received after subscribing.
  useEffect(() => {
    for (const greenhouse of greenhouses) {
      subscribeGreenhouse(greenhouse.code);
      void apiClient.getGreenhouseRealtime(greenhouse.code)
        .then((res) => seedDeviceStates(res.devices ?? []))
        .catch(() => {});
    }
  }, [greenhouses, seedDeviceStates, subscribeGreenhouse]);

  // Fetch sensors for selected device
  const { data: deviceSensors = [], isLoading: isLoadingSensors } = useQuery({
    queryKey: ['device-sensors', selectedDevice?.id],
    queryFn: () => (selectedDevice ? apiClient.getDeviceSensors(selectedDevice.id) : Promise.resolve([])),
    enabled: !!selectedDevice,
  });

  // Fetch actuators for selected device
  const { data: deviceActuators = [], isLoading: isLoadingActuators } = useQuery({
    queryKey: ['device-actuators', selectedDevice?.id],
    queryFn: () => (selectedDevice ? apiClient.getDeviceActuators(selectedDevice.id) : Promise.resolve([])),
    enabled: !!selectedDevice,
  });

  const getGreenhouseName = (greenhouseId: string) => {
    return greenhouses.find((g) => g.id === greenhouseId)?.name ?? greenhouseId;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <Cpu className="h-5 w-5 text-emerald-400" />
              <span>IoT Controllers & Edge Devices</span>
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Active telemetry telemetry nodes, ESP32 controllers, sensors, and actuator interfaces
            </p>
          </div>

          <button
            onClick={() => void refetch()}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-xs font-mono text-slate-300 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh State</span>
          </button>
        </div>

        {/* Device Status Rules Banner */}
        <div className="p-3 rounded-xl border border-slate-800 bg-slate-900/40 text-xs text-slate-400 flex flex-wrap items-center gap-4 font-mono">
          <span className="text-slate-300 font-semibold">HEARTBEAT RULES:</span>
          <span className="flex items-center gap-1.5 text-emerald-400">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            &lt;= 15s ONLINE
          </span>
          <span className="flex items-center gap-1.5 text-amber-400">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            &gt; 15s &amp; &lt;= 30s STALE
          </span>
          <span className="flex items-center gap-1.5 text-rose-400">
            <span className="h-2 w-2 rounded-full bg-rose-400" />
            &gt; 30s OFFLINE
          </span>
        </div>

        {/* Device Table */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-md overflow-hidden">
          {isLoading ? (
            <div className="p-6">
              <SkeletonTable />
            </div>
          ) : devices.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon={Cpu}
                title="No Registered Controllers"
                description="No edge IoT devices have been registered in this organization yet."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/40 text-slate-400 font-mono">
                    <th className="py-3.5 px-6 font-medium">DEVICE MQTT ID</th>
                    <th className="py-3.5 px-6 font-medium">NAME</th>
                    <th className="py-3.5 px-6 font-medium">GREENHOUSE</th>
                    <th className="py-3.5 px-6 font-medium">STATUS</th>
                    <th className="py-3.5 px-6 font-medium">LAST SEEN</th>
                    <th className="py-3.5 px-6 font-medium">FIRMWARE</th>
                    <th className="py-3.5 px-6 font-medium text-right">ACTION</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {devices.map((dev) => {
                    const live = deviceStates[dev.deviceId];
                    const effectiveLastSeen = live?.lastSeenAt ?? dev.lastSeenAt;

                    return (
                      <tr
                        key={dev.id}
                        className="hover:bg-slate-800/30 transition-colors cursor-pointer group"
                        onClick={() => setSelectedDevice(dev)}
                      >
                        <td className="py-4 px-6 font-mono font-bold text-slate-200 group-hover:text-emerald-400 transition-colors">
                          {dev.deviceId}
                        </td>
                        <td className="py-4 px-6 font-medium text-slate-200">{dev.name}</td>
                        <td className="py-4 px-6 text-slate-400">{getGreenhouseName(dev.greenhouseId)}</td>
                        <td className="py-4 px-6">
                          <DeviceStatusBadge
                            status={live?.status ?? dev.status}
                            lastSeenAt={effectiveLastSeen}
                            now={now}
                          />
                        </td>
                        <td className="py-4 px-6 font-mono text-slate-400">
                          {effectiveLastSeen ? new Date(effectiveLastSeen).toLocaleTimeString() : 'Never'}
                        </td>
                        <td className="py-4 px-6 font-mono text-slate-400">
                          {dev.firmwareVersion || 'v1.0.0'}
                        </td>
                        <td className="py-4 px-6 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedDevice(dev);
                            }}
                            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-400 text-xs font-mono transition-colors"
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Inspect Device Modal */}
        {selectedDevice && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <Cpu className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white font-mono">{selectedDevice.deviceId}</h2>
                    <span className="text-xs text-slate-400">{selectedDevice.name} ({selectedDevice.deviceType})</span>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedDevice(null)}
                  className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Status and specs */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                  <span className="text-slate-400 block font-mono">STATUS</span>
                  <div className="mt-1">
                    <DeviceStatusBadge
                      status={deviceStates[selectedDevice.deviceId]?.status ?? selectedDevice.status}
                      lastSeenAt={deviceStates[selectedDevice.deviceId]?.lastSeenAt ?? selectedDevice.lastSeenAt}
                      now={now}
                    />
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                  <span className="text-slate-400 block font-mono">GREENHOUSE</span>
                  <span className="text-slate-200 font-semibold block mt-1">
                    {getGreenhouseName(selectedDevice.greenhouseId)}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                  <span className="text-slate-400 block font-mono">FIRMWARE</span>
                  <span className="text-slate-200 font-mono block mt-1">
                    {selectedDevice.firmwareVersion || 'v1.0.0'}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                  <span className="text-slate-400 block font-mono">LAST HEARTBEAT</span>
                  <span className="text-slate-200 font-mono block mt-1">
                    {deviceStates[selectedDevice.deviceId]?.lastSeenAt
                      ? new Date(deviceStates[selectedDevice.deviceId].lastSeenAt!).toLocaleTimeString()
                      : selectedDevice.lastSeenAt
                      ? new Date(selectedDevice.lastSeenAt).toLocaleTimeString()
                      : 'Never'}
                  </span>
                </div>
              </div>

              {/* Sensors Attached */}
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                  <Activity className="h-4 w-4 text-emerald-400" />
                  <span>Configured Sensors ({deviceSensors.length})</span>
                </h3>
                {isLoadingSensors ? (
                  <div className="h-16 bg-slate-800/40 rounded-xl animate-pulse" />
                ) : deviceSensors.length === 0 ? (
                  <div className="p-4 rounded-xl border border-dashed border-slate-800 text-xs text-slate-400 text-center">
                    No individual sensors configured for this controller yet.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {deviceSensors.map((s: Sensor) => {
                      const liveReading = deviceStates[selectedDevice.deviceId]?.sensors?.[s.code];
                      return (
                        <div key={s.id} className="p-3 rounded-xl bg-slate-950/40 border border-slate-800 text-xs">
                          <div className="flex justify-between items-start">
                            <span className="font-semibold text-slate-200">{s.name}</span>
                            <span className="font-mono text-emerald-400 font-bold text-sm">
                              {liveReading?.numericValue !== undefined && liveReading?.numericValue !== null
                                ? `${liveReading.numericValue} ${s.unit || ''}`
                                : `-- ${s.unit || ''}`}
                            </span>
                          </div>
                          <span className="font-mono text-[10px] text-slate-500 block mt-1">Code: {s.code}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Actuators Attached */}
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                  <Zap className="h-4 w-4 text-emerald-400" />
                  <span>Configured Actuators ({deviceActuators.length})</span>
                </h3>
                {isLoadingActuators ? (
                  <div className="h-16 bg-slate-800/40 rounded-xl animate-pulse" />
                ) : deviceActuators.length === 0 ? (
                  <div className="p-4 rounded-xl border border-dashed border-slate-800 text-xs text-slate-400 text-center">
                    No actuators (pumps, fans, vents) bound to this device.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {deviceActuators.map((a: Actuator) => (
                      <div key={a.id} className="p-3 rounded-xl bg-slate-950/40 border border-slate-800 text-xs flex justify-between items-center">
                        <div>
                          <span className="font-semibold text-slate-200 block">{a.name}</span>
                          <span className="font-mono text-[10px] text-slate-500">Type: {a.actuatorType}</span>
                        </div>
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${a.enabled ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'}`}>
                          {a.enabled ? 'ENABLED' : 'DISABLED'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

'use client';

import React, { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { MetricCard } from '@/components/common/metric-card';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/context/auth-context';
import { useSocket } from '@/context/socket-context';
import {
  Warehouse,
  Radio,
  WifiOff,
  AlertTriangle,
  Thermometer,
  Droplets,
  Sprout,
  Fan,
  Activity,
  ArrowUpRight,
} from 'lucide-react';
import Link from 'next/link';
import { DeviceStatusBadge, GreenhouseStatusBadge } from '@/components/common/status-badge';
import { SkeletonCard, SkeletonTable } from '@/components/common/empty-state';
import { useStatusClock } from '@/hooks/use-status-clock';

export default function DashboardOverviewPage() {
  const { currentOrg } = useAuth();
  const { deviceStates, seedDeviceStates, subscribeGreenhouse } = useSocket();
  const now = useStatusClock();

  // Fetch greenhouses
  const { data: greenhouses = [], isLoading: isLoadingGH } = useQuery({
    queryKey: ['greenhouses', currentOrg?.id],
    queryFn: () => apiClient.getGreenhouses(currentOrg?.id),
  });

  // Fetch devices
  const { data: devices = [], isLoading: isLoadingDevs } = useQuery({
    queryKey: ['devices', currentOrg?.id],
    queryFn: () => apiClient.getDevices(currentOrg?.id),
  });

  // Fetch realtime state by device MQTT ID so the dashboard does not depend on
  // greenhouse topic IDs matching database IDs or codes.
  useEffect(() => {
    for (const greenhouse of greenhouses) {
      subscribeGreenhouse(greenhouse.code);
    }

    if (devices.length > 0) {
      void Promise.all(
        devices.map((device) => apiClient.getDeviceRealtime(device.deviceId)),
      ).then((responses) => {
        seedDeviceStates(
          responses.flatMap((response) => response.data ? [response.data] : []),
        );
      }).catch(() => {});
    }
  }, [greenhouses, devices, seedDeviceStates, subscribeGreenhouse]);

  // Aggregate stats using live deviceStates if available, fallback to devices table
  const stats = useMemo(() => {
    const totalGreenhouses = greenhouses.length;

    let onlineCount = 0;
    let staleCount = 0;
    let offlineCount = 0;

    let totalTemp = 0;
    let tempCount = 0;
    let totalHum = 0;
    let humCount = 0;
    let totalSoil = 0;
    let soilCount = 0;
    let activeActuators = 0;

    for (const dev of devices) {
      const liveState = deviceStates[dev.deviceId];
      const lastSeen = liveState?.lastSeenAt ?? dev.lastSeenAt;

      // Status rule: <=15s ONLINE, >15s & <=30s STALE, >30s OFFLINE
      let isDevOnline = false;
      if (lastSeen) {
        const diffSecs = (now - new Date(lastSeen).getTime()) / 1000;
        if (diffSecs <= 15) { onlineCount++; isDevOnline = true; }
        else if (diffSecs <= 30) { staleCount++; isDevOnline = true; }
        else offlineCount++;
      } else {
        offlineCount++;
      }

      // Only aggregate sensor values when device is online / stale (not offline)
      if (isDevOnline && liveState?.sensors) {
        for (const [code, sensor] of Object.entries(liveState.sensors)) {
          const val = sensor.numericValue;
          if (typeof val === 'number' && val > 0) {
            if (code === 'temp_air' || (code.includes('temp') && !code.includes('soil'))) {
              totalTemp += val;
              tempCount++;
            } else if (code === 'humidity' || code.includes('hum')) {
              totalHum += val;
              humCount++;
            } else if (code === 'soil_moisture' || (code.includes('soil') && !code.includes('temp'))) {
              totalSoil += val;
              soilCount++;
            }
          }
        }
      }
    }

    // Active actuators estimate (fan, pump, valve, etc.)
    // If telemetry or actuator count is active
    devices.forEach((d) => {
      if (d.actuators) {
        activeActuators += d.actuators.filter((a) => a.enabled).length;
      }
    });

    const avgTemp = tempCount > 0 ? (totalTemp / tempCount).toFixed(1) : '--';
    const avgHum = humCount > 0 ? (totalHum / humCount).toFixed(1) : '--';
    const avgSoil = soilCount > 0 ? (totalSoil / soilCount).toFixed(1) : '--';

    return {
      totalGreenhouses,
      onlineDevices: onlineCount,
      staleDevices: staleCount,
      offlineDevices: offlineCount,
      alarmCount: staleCount + (offlineCount > 0 && devices.length > 0 ? 1 : 0),
      avgTemp,
      avgHum,
      avgSoil,
      activeActuators,
    };
  }, [greenhouses, devices, deviceStates, now]);

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {/* Page Title & Subtitle */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2.5">
              <span>Overview & Operations</span>
              <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                Realtime Stream
              </span>
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Low-latency environmental monitoring and status across all facility units
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/realtime"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-950/40 transition-colors"
            >
              <Activity className="h-4 w-4" />
              <span>Open Live Telemetry Feed</span>
            </Link>
          </div>
        </div>

        {/* Primary Metric Cards Grid */}
        {isLoadingGH || isLoadingDevs ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title="Total Greenhouses"
              value={stats.totalGreenhouses}
              icon={Warehouse}
              subtext="Operational facilities"
              color="indigo"
            />
            <MetricCard
              title="Online Devices"
              value={stats.onlineDevices}
              unit={`/ ${devices.length}`}
              icon={Radio}
              subtext="Active heartbeat <= 15s"
              color="emerald"
              isLive={stats.onlineDevices > 0}
            />
            <MetricCard
              title="Offline Devices"
              value={stats.offlineDevices}
              icon={WifiOff}
              subtext={stats.staleDevices > 0 ? `${stats.staleDevices} stale (>15s)` : 'No heartbeat > 30s'}
              color={stats.offlineDevices > 0 ? 'rose' : 'slate'}
            />
            <MetricCard
              title="Warning / Alarms"
              value={stats.alarmCount}
              icon={AlertTriangle}
              subtext="Needs operator check"
              color={stats.alarmCount > 0 ? 'amber' : 'slate'}
            />

            {/* Environmental Realtime Telemetry Aggregates */}
            <MetricCard
              title="Average Air Temp"
              value={stats.avgTemp}
              unit="°C"
              icon={Thermometer}
              subtext="Facility ambient air"
              color="amber"
              isLive={stats.avgTemp !== '--'}
            />
            <MetricCard
              title="Average Humidity"
              value={stats.avgHum}
              unit="%"
              icon={Droplets}
              subtext="Relative humidity"
              color="cyan"
              isLive={stats.avgHum !== '--'}
            />
            <MetricCard
              title="Soil Moisture"
              value={stats.avgSoil}
              unit="%"
              icon={Sprout}
              subtext="Substrate saturation"
              color="emerald"
              isLive={stats.avgSoil !== '--'}
            />
            <MetricCard
              title="Active Actuators"
              value={stats.activeActuators}
              unit="units"
              icon={Fan}
              subtext="Pumps, fans, valves"
              color="indigo"
            />
          </div>
        )}

        {/* Two-Column Detail Panels */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Greenhouses Summary Table */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-md">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-white">Greenhouse Status</h3>
                <p className="text-xs text-slate-400 mt-0.5">Managed greenhouse zones and units</p>
              </div>
              <Link
                href="/greenhouses"
                className="text-xs font-mono text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
              >
                <span>View All</span>
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>

            {isLoadingGH ? (
              <SkeletonTable />
            ) : greenhouses.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400 border border-dashed border-slate-800 rounded-xl">
                No greenhouses registered yet for this organization.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-mono">
                      <th className="pb-3 font-medium">NAME</th>
                      <th className="pb-3 font-medium">CODE</th>
                      <th className="pb-3 font-medium">STATUS</th>
                      <th className="pb-3 font-medium text-right">ACTION</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {greenhouses.slice(0, 5).map((gh) => (
                      <tr key={gh.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-3 font-medium text-slate-200">{gh.name}</td>
                        <td className="py-3 font-mono text-slate-400">{gh.code}</td>
                        <td className="py-3">
                          <GreenhouseStatusBadge status={gh.status} />
                        </td>
                        <td className="py-3 text-right">
                          <Link
                            href={`/greenhouses?id=${gh.id}`}
                            className="text-emerald-400 hover:text-emerald-300 font-mono"
                          >
                            Details →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Quick Devices Status List */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-md">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-white">Live Controller Status</h3>
                <p className="text-xs text-slate-400 mt-0.5">Realtime heartbeat & MQTT device state</p>
              </div>
              <Link
                href="/devices"
                className="text-xs font-mono text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
              >
                <span>View All</span>
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>

            {isLoadingDevs ? (
              <SkeletonTable />
            ) : devices.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400 border border-dashed border-slate-800 rounded-xl">
                No controllers or IoT devices found.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-mono">
                      <th className="pb-3 font-medium">DEVICE ID</th>
                      <th className="pb-3 font-medium">NAME</th>
                      <th className="pb-3 font-medium">TYPE</th>
                      <th className="pb-3 font-medium text-right">STATUS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {devices.slice(0, 5).map((dev) => {
                      const live = deviceStates[dev.deviceId];
                      return (
                        <tr key={dev.id} className="hover:bg-slate-800/30 transition-colors">
                          <td className="py-3 font-mono text-slate-300 font-semibold">{dev.deviceId}</td>
                          <td className="py-3 text-slate-200">{dev.name}</td>
                          <td className="py-3 text-slate-400 font-mono">{dev.deviceType}</td>
                          <td className="py-3 text-right">
                            <DeviceStatusBadge
                              status={live?.status ?? dev.status}
                              lastSeenAt={live?.lastSeenAt ?? dev.lastSeenAt}
                              now={now}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

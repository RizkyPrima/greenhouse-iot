'use client';

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/context/auth-context';
import { TelemetryRecord } from '@/types';
import {
  History as HistoryIcon,
  RefreshCw,
  TrendingUp,
  Table as TableIcon,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { EmptyState } from '@/components/common/empty-state';

export default function HistoryPage() {
  const { currentOrg } = useAuth();

  // Filters
  const [selectedGreenhouseId, setSelectedGreenhouseId] = useState<string>('');
  const [selectedDeviceMqttId, setSelectedDeviceMqttId] = useState<string>('');
  const [selectedSensorCode, setSelectedSensorCode] = useState<string>('ALL');
  const [timeRange, setTimeRange] = useState<string>('24h');
  const [recordLimit, setRecordLimit] = useState<number>(100);

  // Fetch greenhouses
  const { data: greenhouses = [] } = useQuery({
    queryKey: ['greenhouses', currentOrg?.id],
    queryFn: () => apiClient.getGreenhouses(),
  });

  // Fetch devices
  const { data: devices = [] } = useQuery({
    queryKey: ['devices', currentOrg?.id],
    queryFn: () => apiClient.getDevices(),
  });

  // Filter devices based on greenhouse
  const availableDevices = useMemo(() => {
    if (!selectedGreenhouseId) return devices;
    return devices.filter((d) => d.greenhouseId === selectedGreenhouseId);
  }, [devices, selectedGreenhouseId]);

  // Set default device selection when available
  React.useEffect(() => {
    if (availableDevices.length > 0 && !selectedDeviceMqttId) {
      setSelectedDeviceMqttId(availableDevices[0].deviceId);
    }
  }, [availableDevices, selectedDeviceMqttId]);

  // Calculate ISO timestamps based on timeRange
  const { fromIso, toIso } = useMemo(() => {
    const to = new Date();
    const from = new Date();
    if (timeRange === '1h') from.setHours(to.getHours() - 1);
    else if (timeRange === '6h') from.setHours(to.getHours() - 6);
    else if (timeRange === '24h') from.setHours(to.getHours() - 24);
    else if (timeRange === '7d') from.setDate(to.getDate() - 7);
    return { fromIso: from.toISOString(), toIso: to.toISOString() };
  }, [timeRange]);

  // Query historical telemetry from PostgreSQL via API
  const {
    data: historyData,
    isLoading: isLoadingHistory,
    refetch,
  } = useQuery({
    queryKey: ['telemetry-history', selectedDeviceMqttId, recordLimit, fromIso, toIso],
    queryFn: () => {
      if (!selectedDeviceMqttId) {
        return Promise.resolve({ deviceMqttId: '', count: 0, records: [] });
      }
      return apiClient.getDeviceHistory(selectedDeviceMqttId, {
        limit: recordLimit,
        from: fromIso,
        to: toIso,
      });
    },
    enabled: !!selectedDeviceMqttId,
  });

  const records: TelemetryRecord[] = historyData?.records || [];

  // Extract available sensor codes present in the records
  const availableSensors = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) {
      for (const v of r.values) {
        set.add(v.sensorCode);
      }
    }
    return Array.from(set);
  }, [records]);

  // Transform records into chart data
  const chartData = useMemo(() => {
    // Records come in descending order from API; reverse for timeline display
    const sorted = [...records].reverse();

    return sorted.map((r) => {
      const point: Record<string, unknown> = {
        time: new Date(r.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestamp: r.receivedAt,
      };

      for (const val of r.values) {
        if (typeof val.numericValue === 'number') {
          point[val.sensorCode] = val.numericValue;
        }
      }

      return point;
    });
  }, [records]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <HistoryIcon className="h-5 w-5 text-emerald-400" />
              <span>Historical Telemetry Analytics</span>
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Time-series queries from PostgreSQL database with time filtering and parameter trends
            </p>
          </div>

          <button
            onClick={() => void refetch()}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-xs font-mono text-slate-300 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Query Database</span>
          </button>
        </div>

        {/* Filter Controls Bar */}
        <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/70 backdrop-blur-md grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
          {/* Greenhouse filter */}
          <div>
            <label className="block text-[11px] font-mono uppercase text-slate-400 mb-1">
              Greenhouse
            </label>
            <div className="relative">
              <select
                value={selectedGreenhouseId}
                onChange={(e) => {
                  setSelectedGreenhouseId(e.target.value);
                  setSelectedDeviceMqttId(''); // reset device
                }}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
              >
                <option value="">All Greenhouses</option>
                {greenhouses.map((gh) => (
                  <option key={gh.id} value={gh.id}>
                    {gh.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Device filter */}
          <div>
            <label className="block text-[11px] font-mono uppercase text-slate-400 mb-1">
              Target Device (MQTT ID)
            </label>
            <select
              value={selectedDeviceMqttId}
              onChange={(e) => setSelectedDeviceMqttId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
            >
              {availableDevices.map((d) => (
                <option key={d.id} value={d.deviceId}>
                  {d.deviceId} ({d.name})
                </option>
              ))}
            </select>
          </div>

          {/* Sensor filter */}
          <div>
            <label className="block text-[11px] font-mono uppercase text-slate-400 mb-1">
              Sensor Metric
            </label>
            <select
              value={selectedSensorCode}
              onChange={(e) => setSelectedSensorCode(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
            >
              <option value="ALL">All Sensors</option>
              {availableSensors.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>

          {/* Date range */}
          <div>
            <label className="block text-[11px] font-mono uppercase text-slate-400 mb-1">
              Time Window
            </label>
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
            >
              <option value="1h">Last 1 Hour</option>
              <option value="6h">Last 6 Hours</option>
              <option value="24h">Last 24 Hours</option>
              <option value="7d">Last 7 Days</option>
            </select>
          </div>

          {/* Record Limit / Pagination */}
          <div>
            <label className="block text-[11px] font-mono uppercase text-slate-400 mb-1">
              Record Limit (Page)
            </label>
            <select
              value={recordLimit}
              onChange={(e) => setRecordLimit(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
            >
              <option value={50}>50 records</option>
              <option value={100}>100 records</option>
              <option value={200}>200 records</option>
              <option value={500}>500 records</option>
            </select>
          </div>
        </div>

        {/* Chart View */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-md">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-400" />
                <span>Telemetry Trend Visualizer</span>
              </h2>
              <span className="text-xs text-slate-400 mt-0.5 block">
                {records.length} historical samples returned from PostgreSQL
              </span>
            </div>
          </div>

          {isLoadingHistory ? (
            <div className="h-72 flex items-center justify-center text-slate-500 text-xs font-mono">
              Loading historical records...
            </div>
          ) : chartData.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon={TrendingUp}
                title="No Historical Data Found"
                description={`No telemetry records stored for ${selectedDeviceMqttId || 'this controller'} in the selected time range.`}
              />
            </div>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorTemp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorHum" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorSoil" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                  <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#090d16',
                      borderColor: '#334155',
                      borderRadius: '0.75rem',
                      fontSize: '12px',
                      color: '#f8fafc',
                    }}
                  />
                  {(selectedSensorCode === 'ALL' || selectedSensorCode.includes('temp')) && (
                    <Area
                      type="monotone"
                      dataKey={availableSensors.find((s) => s.includes('temp')) || 'temp_air'}
                      stroke="#f59e0b"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorTemp)"
                      name="Temperature"
                    />
                  )}
                  {(selectedSensorCode === 'ALL' || selectedSensorCode.includes('hum')) && (
                    <Area
                      type="monotone"
                      dataKey={availableSensors.find((s) => s.includes('hum')) || 'humidity'}
                      stroke="#06b6d4"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorHum)"
                      name="Humidity"
                    />
                  )}
                  {(selectedSensorCode === 'ALL' || selectedSensorCode.includes('soil')) && (
                    <Area
                      type="monotone"
                      dataKey={availableSensors.find((s) => s.includes('soil')) || 'soil_moisture'}
                      stroke="#10b981"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorSoil)"
                      name="Soil Moisture"
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Historical Records Table */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-md overflow-hidden">
          <div className="p-4 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TableIcon className="h-4 w-4 text-emerald-400" />
              <span className="text-xs font-bold text-white uppercase font-mono">
                Historical Raw Records Log
              </span>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              Showing up to {recordLimit} entries
            </span>
          </div>

          {records.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">
              No historical rows returned.
            </div>
          ) : (
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="sticky top-0 bg-slate-950 border-b border-slate-800 text-slate-400">
                  <tr>
                    <th className="py-2.5 px-4 font-medium">TIMESTAMP</th>
                    <th className="py-2.5 px-4 font-medium">SEQUENCE</th>
                    <th className="py-2.5 px-4 font-medium">DEVICE MQTT ID</th>
                    <th className="py-2.5 px-4 font-medium">VALUES IN BATCH</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {records.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-2.5 px-4 text-slate-300">
                        {new Date(r.receivedAt).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-4 text-slate-400">
                        {r.sequenceNumber ?? 'N/A'}
                      </td>
                      <td className="py-2.5 px-4 text-emerald-400 font-semibold">
                        {r.deviceMqttId}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="flex flex-wrap gap-1.5">
                          {r.values.map((v) => (
                            <span
                              key={v.id}
                              className="px-2 py-0.5 rounded bg-slate-800/80 text-[11px] text-slate-200 border border-slate-700/60"
                            >
                              {v.sensorCode}: {v.numericValue} {v.unit || ''}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

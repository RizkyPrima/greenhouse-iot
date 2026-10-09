'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/context/auth-context';
import { GreenhouseStatusBadge, DeviceStatusBadge } from '@/components/common/status-badge';
import { SkeletonTable, EmptyState } from '@/components/common/empty-state';
import { Greenhouse, Zone, Device } from '@/types';
import { Warehouse, Layers, Cpu, X } from 'lucide-react';

export default function GreenhousesPage() {
  const { currentOrg } = useAuth();
  const [selectedGreenhouse, setSelectedGreenhouse] = useState<Greenhouse | null>(null);

  // Fetch greenhouses
  const { data: greenhouses = [], isLoading } = useQuery({
    queryKey: ['greenhouses', currentOrg?.id],
    queryFn: () => apiClient.getGreenhouses(currentOrg?.id),
  });

  // Fetch all devices to compute device counts per greenhouse
  const { data: devices = [] } = useQuery({
    queryKey: ['devices', currentOrg?.id],
    queryFn: () => apiClient.getDevices(currentOrg?.id),
  });

  // Fetch zones for selected greenhouse if opened
  const { data: selectedZones = [], isLoading: isLoadingZones } = useQuery({
    queryKey: ['zones', selectedGreenhouse?.id],
    queryFn: () => (selectedGreenhouse ? apiClient.getGreenhouseZones(selectedGreenhouse.id) : Promise.resolve([])),
    enabled: !!selectedGreenhouse,
  });

  // Filter devices for selected greenhouse
  const selectedDevices = selectedGreenhouse
    ? devices.filter((d) => d.greenhouseId === selectedGreenhouse.id)
    : [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <Warehouse className="h-5 w-5 text-emerald-400" />
              <span>Greenhouses Management</span>
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Active greenhouse facilities, production zones, and hardware allocations
            </p>
          </div>
        </div>

        {/* Greenhouse List Card */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-md overflow-hidden">
          {isLoading ? (
            <div className="p-6">
              <SkeletonTable />
            </div>
          ) : greenhouses.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon={Warehouse}
                title="No Greenhouses Configured"
                description="This organization does not currently have any greenhouse facilities set up."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/40 text-slate-400 font-mono">
                    <th className="py-3.5 px-6 font-medium">NAME</th>
                    <th className="py-3.5 px-6 font-medium">CODE</th>
                    <th className="py-3.5 px-6 font-medium">STATUS</th>
                    <th className="py-3.5 px-6 font-medium">DEVICES</th>
                    <th className="py-3.5 px-6 font-medium">TIMEZONE / LOCATION</th>
                    <th className="py-3.5 px-6 font-medium">LAST UPDATE</th>
                    <th className="py-3.5 px-6 font-medium text-right">ACTION</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {greenhouses.map((gh) => {
                    const ghDevices = devices.filter((d) => d.greenhouseId === gh.id);

                    return (
                      <tr
                        key={gh.id}
                        className="hover:bg-slate-800/30 transition-colors cursor-pointer group"
                        onClick={() => setSelectedGreenhouse(gh)}
                      >
                        <td className="py-4 px-6 font-semibold text-slate-200 group-hover:text-emerald-400 transition-colors">
                          {gh.name}
                        </td>
                        <td className="py-4 px-6 font-mono text-slate-400">{gh.code}</td>
                        <td className="py-4 px-6">
                          <GreenhouseStatusBadge status={gh.status} />
                        </td>
                        <td className="py-4 px-6">
                          <span className="font-mono text-slate-300 font-medium">
                            {ghDevices.length} {ghDevices.length === 1 ? 'device' : 'devices'}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-slate-400">
                          {gh.location ? `${gh.location} (${gh.timezone})` : gh.timezone}
                        </td>
                        <td className="py-4 px-6 font-mono text-slate-400">
                          {new Date(gh.updatedAt).toLocaleString()}
                        </td>
                        <td className="py-4 px-6 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedGreenhouse(gh);
                            }}
                            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-400 text-xs font-mono transition-colors"
                          >
                            View Details
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

        {/* Selected Greenhouse Detail Drawer / Modal */}
        {selectedGreenhouse && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <Warehouse className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white">{selectedGreenhouse.name}</h2>
                    <span className="text-xs font-mono text-slate-400">Code: {selectedGreenhouse.code}</span>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedGreenhouse(null)}
                  className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Greenhouse Specs Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                  <span className="text-slate-400 block font-mono">STATUS</span>
                  <div className="mt-1">
                    <GreenhouseStatusBadge status={selectedGreenhouse.status} />
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                  <span className="text-slate-400 block font-mono">TIMEZONE</span>
                  <span className="text-slate-200 font-semibold block mt-1">{selectedGreenhouse.timezone}</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                  <span className="text-slate-400 block font-mono">LOCATION</span>
                  <span className="text-slate-200 font-semibold block mt-1">{selectedGreenhouse.location || 'N/A'}</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                  <span className="text-slate-400 block font-mono">TOTAL DEVICES</span>
                  <span className="text-emerald-400 font-mono font-bold block mt-1 text-sm">{selectedDevices.length}</span>
                </div>
              </div>

              {/* Zones Subsection */}
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                  <Layers className="h-4 w-4 text-emerald-400" />
                  <span>Zones within Facility</span>
                </h3>
                {isLoadingZones ? (
                  <div className="h-20 bg-slate-800/40 rounded-xl animate-pulse" />
                ) : selectedZones.length === 0 ? (
                  <div className="p-4 rounded-xl border border-dashed border-slate-800 text-xs text-slate-400 text-center">
                    No individual zones defined yet. The greenhouse operates as a unified open zone.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {selectedZones.map((z: Zone) => (
                      <div key={z.id} className="p-3 rounded-xl bg-slate-950/40 border border-slate-800 flex items-center justify-between text-xs">
                        <div>
                          <span className="font-semibold text-slate-200 block">{z.name}</span>
                          <span className="font-mono text-slate-400 text-[11px]">Code: {z.code}</span>
                        </div>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                          {z.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Devices Subsection */}
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                  <Cpu className="h-4 w-4 text-emerald-400" />
                  <span>Assigned IoT Controllers</span>
                </h3>
                {selectedDevices.length === 0 ? (
                  <div className="p-4 rounded-xl border border-dashed border-slate-800 text-xs text-slate-400 text-center">
                    No hardware devices bound to this greenhouse.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedDevices.map((d: Device) => (
                      <div
                        key={d.id}
                        className="p-3 rounded-xl bg-slate-950/40 border border-slate-800 flex items-center justify-between text-xs"
                      >
                        <div>
                          <span className="font-semibold text-slate-200">{d.name}</span>
                          <span className="font-mono text-slate-400 ml-2">({d.deviceId})</span>
                        </div>
                        <DeviceStatusBadge status={d.status} lastSeenAt={d.lastSeenAt} />
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

import React, { useEffect, useState } from 'react';
import { Cpu, Database, Moon, Radio, Settings, Sun } from 'lucide-react';
import { api } from '../services/api.ts';
import { useAuth } from '../hooks/useAuth.tsx';
import type { ActiveLocation, AqiStandard } from '../types/env.ts';

export function AdminSettingsPage({
  location,
  standard,
  onChangeStandard,
  theme,
  onToggleTheme,
  refreshIntervalSec,
  onChangeRefreshInterval,
  onRequireAuth,
  onStationsUpdated,
}: {
  location: ActiveLocation;
  standard: AqiStandard;
  onChangeStandard: (std: AqiStandard) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  refreshIntervalSec: number;
  onChangeRefreshInterval: (sec: number) => void;
  onRequireAuth: () => void;
  onStationsUpdated: () => void;
}) {
  const { user, token } = useAuth();
  const [sources, setSources] = useState<
    Array<{
      id: string;
      name: string;
      type: string;
      requiresKey: boolean;
      configured: boolean;
      enabled: boolean;
    }>
  >([]);
  const [iotDevices, setIotDevices] = useState<
    Array<{
      device: {
        deviceId: string;
        name: string;
        lat: number;
        lon: number;
        hardwareModel: string;
        calibrationOffsetPm25: number;
        status: string;
        lastReadingAt: string;
      };
      latest: {
        pm2_5: number | null;
        pm10: number | null;
        temperature: number | null;
        humidity: number | null;
        qualityFlag: string;
        recordedAt: string;
      } | null;
    }>
  >([]);

  const [devName, setDevName] = useState('');
  const [devModel, setDevModel] = useState('ESP32-S3 + Sensirion SPS30');
  const [devOffset, setDevOffset] = useState(0);
  const [testPm25, setTestPm25] = useState(18.5);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const loadAdminData = async () => {
    try {
      const [adm, iot] = await Promise.all([api.getAdminSettings(), api.getIotDevices()]);
      setSources(adm.sources);
      setIotDevices(iot.devices);
    } catch (err) {
      console.error('Failed loading admin settings:', err);
    }
  };

  useEffect(() => {
    void loadAdminData();
  }, []);

  const handleRegisterIot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !token) {
      onRequireAuth();
      return;
    }
    try {
      await api.registerIotDevice(token, {
        name: devName.trim(),
        lat: location.lat,
        lon: location.lon,
        hardwareModel: devModel.trim(),
        calibrationOffsetPm25: devOffset,
      });
      setDevName('');
      setStatusMessage('ESP32 IoT node registered at active coordinates.');
      await loadAdminData();
      onStationsUpdated();
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Failed to register device.');
    }
  };

  const handleIngestSample = async (deviceId: string) => {
    try {
      await api.ingestIotReading({
        deviceId,
        pm2_5: testPm25,
        pm10: Number((testPm25 * 1.45).toFixed(1)),
        temperature: 21.4,
        humidity: 54,
      });
      setStatusMessage(`Ingested ESP32 telemetry packet for ${deviceId}.`);
      await loadAdminData();
      onStationsUpdated();
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'IoT ingestion failed.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 dark:border-slate-800 pb-4">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          Administration, Settings & IoT Ingestion
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Configure AQI standards, refresh intervals, theme appearance, data provider integrations, and ESP32 IoT sensor nodes.
        </p>
      </div>

      {/* User & Display Preferences */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Settings className="w-4 h-4 text-cyan-500" />
            <span>Dashboard & Telemetry Preferences</span>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between py-2 border-b border-slate-200 dark:border-slate-800">
              <div>
                <div className="font-medium text-slate-900 dark:text-slate-100">AQI Standard</div>
                <div className="text-slate-500">Switch between US EPA and European EAQI scales</div>
              </div>
              <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900">
                {(['US_AQI', 'EU_AQI'] as const).map((std) => (
                  <button
                    key={std}
                    type="button"
                    onClick={() => onChangeStandard(std)}
                    className={`px-2.5 py-1 rounded-md font-medium ${
                      standard === std
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-500'
                    }`}
                  >
                    {std === 'US_AQI' ? 'US EPA' : 'EU EAQI'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between py-2 border-b border-slate-200 dark:border-slate-800">
              <div>
                <div className="font-medium text-slate-900 dark:text-slate-100">Color Theme</div>
                <div className="text-slate-500">Toggle dark navy or light daylight workspace</div>
              </div>
              <button
                type="button"
                onClick={onToggleTheme}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 font-medium"
              >
                {theme === 'dark' ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-cyan-600" />}
                <span>{theme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}</span>
              </button>
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <div className="font-medium text-slate-900 dark:text-slate-100">
                  Live Auto-Refresh Interval
                </div>
                <div className="text-slate-500">Interval for automatic environmental polling</div>
              </div>
              <select
                value={refreshIntervalSec}
                onChange={(e) => onChangeRefreshInterval(Number(e.target.value))}
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
              >
                <option value={60}>1 min (60s)</option>
                <option value={300}>5 min (300s)</option>
                <option value={600}>10 min (600s)</option>
                <option value={1800}>30 min (1800s)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Data Providers Status */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Database className="w-4 h-4 text-emerald-500" />
            <span>Configured Environmental Data Providers</span>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
            {sources.map((src) => (
              <div key={src.id} className="py-2.5 flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium text-slate-900 dark:text-slate-100">{src.name}</div>
                  <div className="text-slate-500">{src.type}</div>
                </div>
                <span
                  className={`font-mono text-[11px] ${
                    src.configured && src.enabled
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {src.configured && src.enabled
                    ? 'Active'
                    : src.requiresKey && !src.configured
                      ? 'Key Optional / Unset'
                      : 'Disabled'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ESP32 / IoT Sensor Integration */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Radio className="w-4 h-4 text-cyan-500" />
            <span>ESP32 / IoT Sensor Network & Ingestion API</span>
          </div>
          <span className="text-xs font-mono text-slate-500">POST /api/iot/readings</span>
        </div>

        {statusMessage && (
          <div className="p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-xs text-cyan-600 dark:text-cyan-300">
            {statusMessage}
          </div>
        )}

        <form onSubmit={handleRegisterIot} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Sensor Node Name</label>
            <input
              type="text"
              required
              value={devName}
              onChange={(e) => setDevName(e.target.value)}
              placeholder="Market St ESP32 Node"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Hardware Model</label>
            <input
              type="text"
              value={devModel}
              onChange={(e) => setDevModel(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">PM2.5 Calibration Offset</label>
            <input
              type="number"
              step="0.1"
              value={devOffset}
              onChange={(e) => setDevOffset(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-mono"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium"
          >
            Register at Active Coords
          </button>
        </form>

        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {iotDevices.map(({ device, latest }) => (
            <div
              key={device.deviceId}
              className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs"
            >
              <div>
                <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                  <Cpu className="w-3.5 h-3.5 text-cyan-500" />
                  <span>{device.name}</span>
                  <span className="font-mono text-[11px] text-slate-500">({device.deviceId})</span>
                </div>
                <div className="text-slate-500 mt-0.5 font-mono tabular-nums">
                  {device.hardwareModel} · ({device.lat.toFixed(4)}, {device.lon.toFixed(4)}) · Offset{' '}
                  {device.calibrationOffsetPm25} µg/m³
                </div>
                {latest && (
                  <div className="text-emerald-600 dark:text-emerald-400 font-mono tabular-nums mt-0.5">
                    Latest: PM2.5 {latest.pm2_5} µg/m³ · Flag: {latest.qualityFlag} ·{' '}
                    {latest.recordedAt.slice(0, 19).replace('T', ' ')} UTC
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.5"
                  min={0}
                  value={testPm25}
                  onChange={(e) => setTestPm25(Number(e.target.value))}
                  aria-label="Test PM2.5 reading"
                  className="w-20 px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => handleIngestSample(device.deviceId)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
                >
                  Send Telemetry Packet
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

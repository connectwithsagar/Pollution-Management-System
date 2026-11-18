import React from 'react';
import {
  Activity,
  AlertTriangle,
  Bookmark,
  Compass,
  Crosshair,
  Droplets,
  MapPin,
  RefreshCw,
  Thermometer,
  Wind,
} from 'lucide-react';
import { TimeSeriesTelemetryChart, type SeriesPoint } from '../components/Charts.tsx';
import {
  formatMetric,
  formatTimeAgo,
  formatWindCompass,
  getAqiCategory,
  type ActiveLocation,
  type AirQualityReading,
  type AqiStandard,
  type ForecastResponse,
  type HotspotCluster,
  type HourlyPoint,
  type NavPageId,
  type StationNode,
} from '../types/env.ts';

export function OverviewPage({
  location,
  current,
  history,
  forecast,
  stations,
  hotspots,
  standard,
  loading,
  telemetryError,
  lastRefreshIso,
  wsConnected,
  autoSyncEnabled,
  syncIntervalSec,
  onToggleAutoSync,
  onChangeSyncInterval,
  onRefresh,
  onSaveLocation,
  onLocateUser,
  locatingUser,
  onNavigate,
}: {
  location: ActiveLocation;
  current: AirQualityReading | null;
  history: HourlyPoint[];
  forecast: ForecastResponse | null;
  stations: StationNode[];
  hotspots: HotspotCluster[];
  standard: AqiStandard;
  loading: boolean;
  telemetryError?: string | null;
  lastRefreshIso: string | null;
  wsConnected: boolean;
  autoSyncEnabled: boolean;
  syncIntervalSec: number;
  onToggleAutoSync: () => void;
  onChangeSyncInterval: (sec: number) => void;
  onRefresh: () => void;
  onSaveLocation: () => void;
  onLocateUser: () => void;
  locatingUser: boolean;
  onNavigate: (page: NavPageId) => void;
}) {
  const aqiVal =
    standard === 'EU_AQI' ? current?.pollutants.euAqi ?? null : current?.pollutants.usAqi ?? null;
  const cat = getAqiCategory(aqiVal, standard);

  const chartSeries: SeriesPoint[] = [
    ...history.slice(-24).map((pt) => ({
      label: pt.timestamp.slice(11, 16),
      timestamp: pt.timestamp,
      observed: pt.pm2_5,
      forecast: null,
    })),
    ...(forecast?.status === 'ready'
      ? forecast.predictions.slice(0, 12).map((fp) => ({
          label: fp.timestamp.slice(11, 16),
          timestamp: fp.timestamp,
          observed: null,
          forecast: fp.predictedValue,
          lower: fp.lowerBound,
          upper: fp.upperBound,
        }))
      : []),
  ];

  const pollutantCards = [
    { key: 'PM2.5', value: current?.pollutants.pm2_5, unit: 'µg/m³', limit: 'WHO 15 µg/m³ (24h)' },
    { key: 'PM10', value: current?.pollutants.pm10, unit: 'µg/m³', limit: 'WHO 45 µg/m³ (24h)' },
    { key: 'NO2', value: current?.pollutants.no2, unit: 'µg/m³', limit: 'WHO 25 µg/m³ (24h)' },
    { key: 'O3', value: current?.pollutants.o3, unit: 'µg/m³', limit: 'WHO 100 µg/m³ (8h)' },
    { key: 'SO2', value: current?.pollutants.so2, unit: 'µg/m³', limit: 'WHO 40 µg/m³ (24h)' },
    { key: 'CO', value: current?.pollutants.co, unit: 'µg/m³', limit: 'WHO 4000 µg/m³ (24h)' },
  ];

  return (
    <div className="space-y-6">
      {/* Location & Freshness Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>{current?.provider || 'Open-Meteo CAMS'}</span>
            <span aria-hidden="true">·</span>
            <span>{current?.sourceType === 'observed' ? 'Observed Sensor' : 'Modeled Estimate'}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              Observation: {formatTimeAgo(current?.observedAt)}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              Synced: {formatTimeAgo(lastRefreshIso)}
            </span>
            <span aria-hidden="true">·</span>
            <span
              className={`inline-flex items-center gap-1.5 ${
                !autoSyncEnabled
                  ? 'text-slate-500 dark:text-slate-400'
                  : wsConnected
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-cyan-600 dark:text-cyan-400'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  !autoSyncEnabled
                    ? 'bg-slate-400'
                    : wsConnected
                      ? 'bg-emerald-500 animate-pulse'
                      : 'bg-cyan-500'
                }`}
              />
              <span>
                {!autoSyncEnabled
                  ? 'Auto-Sync Paused'
                  : wsConnected
                    ? `Live WS Sync (${syncIntervalSec}s)`
                    : `Live HTTP Sync (${syncIntervalSec}s)`}
              </span>
            </span>
          </div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100 mt-1">
            {location.name}
          </h1>
          <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Coordinates: {location.lat.toFixed(4)}, {location.lon.toFixed(4)}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 overflow-hidden text-xs">
            <button
              type="button"
              onClick={onToggleAutoSync}
              className={`px-2.5 py-2 font-medium whitespace-nowrap shrink-0 transition-colors ${
                autoSyncEnabled
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {autoSyncEnabled ? 'Auto-Sync: ON' : 'Auto-Sync: OFF'}
            </button>
            <select
              aria-label="Open-Meteo real-time sync interval"
              value={syncIntervalSec}
              onChange={(e) => onChangeSyncInterval(Number(e.target.value))}
              className="px-2 py-2 bg-transparent border-l border-slate-300 dark:border-slate-700 text-xs font-mono text-slate-700 dark:text-slate-200 focus:outline-none"
            >
              <option value={15}>15s</option>
              <option value={30}>30s</option>
              <option value={60}>1m</option>
              <option value={300}>5m</option>
            </select>
          </div>
          <button
            type="button"
            onClick={onLocateUser}
            disabled={locatingUser}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <Crosshair className={`w-3.5 h-3.5 text-cyan-500 ${locatingUser ? 'animate-pulse' : ''}`} />
            <span>{locatingUser ? 'Locating...' : 'My Location'}</span>
          </button>
          <button
            type="button"
            onClick={onSaveLocation}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <Bookmark className="w-3.5 h-3.5 text-cyan-500" />
            <span>Save Location</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('map')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <MapPin className="w-3.5 h-3.5 text-emerald-500" />
            <span>Open Live Map</span>
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white text-xs font-medium whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Syncing...' : 'Sync Open-Meteo'}</span>
          </button>
        </div>
      </div>

      {(telemetryError ||
        (current?.providerErrors && current.providerErrors.length > 0)) && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs text-amber-800 dark:text-amber-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <strong>Open-Meteo / Provider Notice:</strong>{' '}
              {telemetryError || current?.providerErrors.join(' · ')}
            </div>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-xs font-medium whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Retry Sync</span>
          </button>
        </div>
      )}

      {/* Top Hero Split: Primary AQI Indicator + Weather & Nearest Sensor */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        <div
          className={`lg:col-span-5 rounded-xl border ${cat.surfaceClass} bg-white dark:bg-[#0D1526] p-6 flex flex-col justify-between`}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {standard === 'EU_AQI' ? 'European Air Quality Index' : 'US EPA Air Quality Index'}
              </div>
              <div className="mt-2 flex items-baseline gap-3">
                <span
                  className="text-5xl font-bold font-mono tabular-nums"
                  style={{ color: cat.colorHex }}
                >
                  {aqiVal !== null ? Math.round(aqiVal) : 'Unavailable'}
                </span>
                <span className={`text-sm font-semibold ${cat.textClass}`}>{cat.label}</span>
              </div>
            </div>
            <Activity className="w-5 h-5 text-cyan-500 shrink-0" />
          </div>

          <p className="text-sm text-slate-600 dark:text-slate-300 mt-4 leading-relaxed">
            {cat.advisory}
          </p>

          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
            Methodology: {current?.methodology || 'Open-Meteo Atmospheric CAMS'}
          </div>
        </div>

        {/* Weather & Nearest Ground Station Telemetry */}
        <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] p-5 flex flex-col justify-between">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Meteorological Conditions
            </div>
            <div className="grid grid-cols-2 gap-4 my-4">
              <div>
                <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <Thermometer className="w-3.5 h-3.5 text-cyan-500" />
                  <span>Temperature</span>
                </div>
                <div className="text-xl font-semibold font-mono tabular-nums mt-1">
                  {formatMetric(current?.weather.temperature)} °C
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <Droplets className="w-3.5 h-3.5 text-cyan-500" />
                  <span>Humidity</span>
                </div>
                <div className="text-xl font-semibold font-mono tabular-nums mt-1">
                  {formatMetric(current?.weather.humidity, 0)} %
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <Wind className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Wind Speed</span>
                </div>
                <div className="text-xl font-semibold font-mono tabular-nums mt-1">
                  {formatMetric(current?.weather.windSpeed)} km/h
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <Compass className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Direction</span>
                </div>
                <div className="text-sm font-semibold font-mono tabular-nums mt-2">
                  {formatWindCompass(current?.weather.windDirection ?? null)}
                </div>
              </div>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              Pressure: {formatMetric(current?.weather.surfacePressure, 0)} hPa
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Nearest Ground Sensor
              </span>
              <span className="text-xs font-mono tabular-nums text-cyan-600 dark:text-cyan-400">
                {stations.length} stations in 25 km
              </span>
            </div>

            {current?.nearestObservedStation ? (
              <div className="my-3 space-y-2">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {current.nearestObservedStation.name}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {current.nearestObservedStation.provider} · Observed ·{' '}
                  {current.nearestObservedStation.distanceKm} km away
                </div>
                <div className="grid grid-cols-2 gap-2 pt-2 font-mono tabular-nums text-xs">
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Observed PM2.5</div>
                    <div className="text-base font-semibold">
                      {formatMetric(current.nearestObservedStation.pm2_5)} µg/m³
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Observed PM10</div>
                    <div className="text-base font-semibold">
                      {formatMetric(current.nearestObservedStation.pm10)} µg/m³
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="my-4 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                No physical ground monitoring sensor reported within 12 km of these coordinates. Modeled atmospheric data is displayed with explicit attribution.
              </div>
            )}

            <button
              type="button"
              onClick={() => onNavigate('hotspots')}
              className="w-full py-2 px-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium flex items-center justify-between"
            >
              <span className="inline-flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                <span>Detected Hotspots (25 km)</span>
              </span>
              <span className="font-mono tabular-nums font-semibold">{hotspots.length}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 6 Pollutant Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {pollutantCards.map((item) => (
          <div
            key={item.key}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] p-4"
          >
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {item.key}
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {item.value !== null && item.value !== undefined ? item.value.toFixed(1) : 'N/A'}
              </span>
              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                {item.value !== null && item.value !== undefined ? item.unit : ''}
              </span>
            </div>
            <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
              {item.limit}
            </div>
          </div>
        ))}
      </div>

      {/* 24h Trend + AI Forecast Trajectory */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              PM2.5 Trajectory: Recent 24h Modeled History & 12h AI Forecast
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Solid cyan curve shows historical Open-Meteo readings; dashed emerald curve shows Python Random Forest predictions with 90% uncertainty band.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('predictions')}
            className="text-xs font-medium text-cyan-600 dark:text-cyan-400 hover:underline whitespace-nowrap shrink-0"
          >
            Inspect AI Model Metrics →
          </button>
        </div>

        <TimeSeriesTelemetryChart
          data={chartSeries}
          unit="µg/m³"
          observedLabel="Modeled History (Open-Meteo)"
          forecastLabel={
            forecast?.status === 'ready'
              ? `AI Forecast (${forecast.modelVersion})`
              : 'AI Forecast Unavailable'
          }
          threshold={35.4}
        />
      </div>
    </div>
  );
}

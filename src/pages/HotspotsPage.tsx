import React from 'react';
import { AlertTriangle, Download, FileText, MapPin, RefreshCw } from 'lucide-react';
import { downloadCsv, exportPollutionSummaryPdf } from '../services/exportUtils.ts';
import {
  formatTimeAgo,
  type ActiveLocation,
  type AirQualityReading,
  type HotspotResponse,
  type HourlyPoint,
  type NavPageId,
} from '../types/env.ts';

export function HotspotsPage({
  location,
  current,
  history,
  hotspotsRes,
  pollutant,
  epsKm,
  threshold,
  loading,
  onChangeParams,
  onRefresh,
  onNavigate,
}: {
  location: ActiveLocation;
  current: AirQualityReading | null;
  history: HourlyPoint[];
  hotspotsRes: HotspotResponse | null;
  pollutant: string;
  epsKm: number;
  threshold: number;
  loading: boolean;
  onChangeParams: (next: { pollutant?: string; epsKm?: number; threshold?: number }) => void;
  onRefresh: () => void;
  onNavigate: (page: NavPageId) => void;
}) {
  const hotspots = hotspotsRes?.hotspots ?? [];

  const exportCsv = () => {
    downloadCsv(
      `AetherGrid_Hotspots_${location.name.replace(/\s+/g, '_')}.csv`,
      [
        'id',
        'label',
        'cluster_type',
        'pollutant',
        'centroid_lat',
        'centroid_lon',
        'radius_km',
        'peak_value',
        'mean_value',
        'threshold',
        'severity',
        'station_count',
        'is_modeled_surface',
        'observed_at',
      ],
      hotspots.map((h) => [
        h.id,
        h.label,
        h.clusterType,
        h.pollutant,
        h.centroidLat,
        h.centroidLon,
        h.radiusKm,
        h.peakValue,
        h.meanValue,
        h.threshold,
        h.severity,
        h.stationCount,
        h.isModeledSurface ? 'true' : 'false',
        h.observedAt,
      ])
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
            Pollution Hotspot Analysis (DBSCAN)
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Spatial threshold and Haversine DBSCAN clustering across observed sensors and modeled metro grid cells around {location.name}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Download className="w-3.5 h-3.5 text-cyan-500" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={() =>
              exportPollutionSummaryPdf({
                title: 'Hotspot Detection Summary',
                locationName: location.name,
                lat: location.lat,
                lon: location.lon,
                current,
                hourly: history,
                hotspots: hotspotsRes,
              })
            }
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <FileText className="w-3.5 h-3.5 text-emerald-500" />
            <span>PDF Summary</span>
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Run Clustering</span>
          </button>
        </div>
      </div>

      {/* Parameters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526]">
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
            Target Pollutant
          </label>
          <select
            value={pollutant}
            onChange={(e) => {
              const p = e.target.value;
              const defaults: Record<string, number> = {
                pm2_5: 25,
                pm10: 50,
                us_aqi: 100,
                no2: 80,
                o3: 100,
              };
              onChangeParams({ pollutant: p, threshold: defaults[p] ?? 25 });
            }}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
          >
            <option value="pm2_5">PM2.5 (µg/m³)</option>
            <option value="pm10">PM10 (µg/m³)</option>
            <option value="us_aqi">US AQI</option>
            <option value="no2">NO2 (µg/m³)</option>
            <option value="o3">O3 (µg/m³)</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
            Exceedance Threshold
          </label>
          <input
            type="number"
            min={1}
            step="1"
            value={threshold}
            onChange={(e) => onChangeParams({ threshold: Number(e.target.value) })}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-mono tabular-nums"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
            DBSCAN Cluster Radius (eps km)
          </label>
          <input
            type="number"
            min={1}
            max={30}
            step="0.5"
            value={epsKm}
            onChange={(e) => onChangeParams({ epsKm: Number(e.target.value) })}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-mono tabular-nums"
          />
        </div>
      </div>

      {/* Scientific Precision Notice */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-3.5 text-xs text-slate-600 dark:text-slate-400">
        <strong>Spatial Attribution Notice:</strong>{' '}
        {hotspotsRes?.precisionNotice ||
          'Regional cluster analysis only; sparse station coverage does not imply street-level uniformity.'}{' '}
        Evaluated {hotspotsRes?.evaluatedPoints ?? 0} total nodes ·{' '}
        {hotspotsRes?.elevatedPoints ?? 0} exceeding threshold.
      </div>

      {hotspots.length === 0 ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center space-y-2">
          <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            No Pollution Hotspots Detected Above {threshold}
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            All evaluated stations and modeled grid cells within 25 km are currently below the selected {pollutant.toUpperCase()} threshold. Lower the threshold to inspect milder gradients.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {hotspots.map((hs) => (
            <div
              key={hs.id}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] p-5 space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 text-xs">
                    <AlertTriangle
                      className={`w-3.5 h-3.5 ${
                        hs.severity === 'critical'
                          ? 'text-rose-500'
                          : hs.severity === 'high'
                            ? 'text-orange-500'
                            : 'text-amber-500'
                      }`}
                    />
                    <span className="font-semibold uppercase text-slate-700 dark:text-slate-200">
                      {hs.severity}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="text-slate-500">
                      {hs.isModeledSurface ? 'Modeled Surface' : 'Observed Sensor Cluster'}
                    </span>
                  </div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-1">
                    {hs.label}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('map')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                >
                  <MapPin className="w-3 h-3 text-cyan-500" />
                  <span>Map</span>
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs font-mono tabular-nums">
                <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] text-slate-500">Peak</div>
                  <div className="text-sm font-semibold">{hs.peakValue}</div>
                </div>
                <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] text-slate-500">Cluster Mean</div>
                  <div className="text-sm font-semibold">{hs.meanValue}</div>
                </div>
                <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] text-slate-500">Radius / Nodes</div>
                  <div className="text-sm font-semibold">
                    {hs.radiusKm}km ({hs.stationCount})
                  </div>
                </div>
              </div>

              <div className="text-xs text-slate-500 dark:text-slate-400">
                Centroid: <span className="font-mono tabular-nums">{hs.centroidLat}, {hs.centroidLon}</span> · Observed {formatTimeAgo(hs.observedAt)}
              </div>

              <div className="text-xs text-slate-600 dark:text-slate-300">
                Supporting nodes:{' '}
                {hs.supportingStations.map((s) => `${s.name} (${s.value})`).join(', ')}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

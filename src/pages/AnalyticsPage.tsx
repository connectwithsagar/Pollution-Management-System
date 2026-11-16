import React, { useMemo, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import {
  BarDistributionChart,
  ScatterCorrelationChart,
  TimeSeriesTelemetryChart,
} from '../components/Charts.tsx';
import { downloadCsv, exportPollutionSummaryPdf } from '../services/exportUtils.ts';
import {
  formatMetric,
  type ActiveLocation,
  type AirQualityReading,
  type HourlyPoint,
  type StationNode,
} from '../types/env.ts';

type PollutantKey = 'pm2_5' | 'pm10' | 'no2' | 'o3' | 'so2' | 'co' | 'usAqi';

export function AnalyticsPage({
  location,
  current,
  history,
  observedStations,
  modeledGrid,
  onDaysChange,
  days,
}: {
  location: ActiveLocation;
  current: AirQualityReading | null;
  history: HourlyPoint[];
  observedStations: StationNode[];
  modeledGrid: StationNode[];
  days: number;
  onDaysChange: (d: number) => void;
}) {
  const [pollutant, setPollutant] = useState<PollutantKey>('pm2_5');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'observed' | 'modeled'>('all');
  const [weatherAxis, setWeatherAxis] = useState<'windSpeed' | 'humidity' | 'temperature'>(
    'windSpeed'
  );

  const unitLabel = pollutant === 'usAqi' ? 'AQI' : 'µg/m³';

  const trendData = useMemo(
    () =>
      history.map((pt) => ({
        label: pt.timestamp.slice(5, 16).replace('T', ' '),
        timestamp: pt.timestamp,
        observed: pt[pollutant] ?? null,
      })),
    [history, pollutant]
  );

  const dailyAverages = useMemo(() => {
    const byDay = new Map<string, number[]>();
    for (const pt of history) {
      const val = pt[pollutant];
      if (val === null || val === undefined) continue;
      const day = pt.timestamp.slice(0, 10);
      const arr = byDay.get(day) ?? [];
      arr.push(val);
      byDay.set(day, arr);
    }
    return Array.from(byDay.entries()).map(([day, vals]) => ({
      label: day.slice(5),
      value: vals.reduce((a, b) => a + b, 0) / vals.length,
    }));
  }, [history, pollutant]);

  const scatterPoints = useMemo(() => {
    return history
      .filter((pt) => pt[pollutant] !== null && pt[weatherAxis] !== null)
      .slice(-72)
      .map((pt) => ({
        x: Number(pt[weatherAxis]),
        y: Number(pt[pollutant]),
        label: pt.timestamp.slice(5, 16).replace('T', ' '),
      }));
  }, [history, pollutant, weatherAxis]);

  const combinedStations = useMemo(() => {
    const list = [
      ...(sourceFilter !== 'modeled' ? observedStations : []),
      ...(sourceFilter !== 'observed' ? modeledGrid : []),
    ];
    const valid = list.filter((s) => {
      const v = pollutant === 'usAqi' ? s.us_aqi : s[pollutant];
      return v !== null && v !== undefined;
    });
    const sorted = [...valid].sort((a, b) => {
      const va = (pollutant === 'usAqi' ? a.us_aqi : a[pollutant]) ?? 0;
      const vb = (pollutant === 'usAqi' ? b.us_aqi : b[pollutant]) ?? 0;
      return vb - va;
    });
    return {
      highest: sorted.slice(0, 5),
      lowest: [...sorted].reverse().slice(0, 5),
    };
  }, [observedStations, modeledGrid, pollutant, sourceFilter]);

  const handleExportCsv = () => {
    downloadCsv(
      `AetherGrid_Analytics_${location.name.replace(/\s+/g, '_')}.csv`,
      [
        'timestamp_utc',
        'provider',
        'source_type',
        'us_aqi',
        'eu_aqi',
        'pm2_5_ugm3',
        'pm10_ugm3',
        'no2_ugm3',
        'o3_ugm3',
        'temperature_c',
        'humidity_pct',
        'wind_speed_kmh',
      ],
      history.map((h) => [
        h.timestamp,
        h.provider,
        h.sourceType,
        h.usAqi,
        h.euAqi,
        h.pm2_5,
        h.pm10,
        h.no2,
        h.o3,
        h.temperature,
        h.humidity,
        h.windSpeed,
      ])
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
            Pollution Analytics & Weather Relationships
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {location.name} · Observed physical stations ({observedStations.length}) & Modeled grid cells ({modeledGrid.length})
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Download className="w-3.5 h-3.5 text-cyan-500" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={() =>
              exportPollutionSummaryPdf({
                title: 'Pollution Analytics Summary',
                locationName: location.name,
                lat: location.lat,
                lon: location.lon,
                current,
                hourly: history,
              })
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Download PDF Report</span>
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-3 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526]">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500 dark:text-slate-400">Pollutant:</span>
          <select
            value={pollutant}
            onChange={(e) => setPollutant(e.target.value as PollutantKey)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
          >
            <option value="pm2_5">PM2.5 (µg/m³)</option>
            <option value="pm10">PM10 (µg/m³)</option>
            <option value="no2">NO2 (µg/m³)</option>
            <option value="o3">O3 (µg/m³)</option>
            <option value="so2">SO2 (µg/m³)</option>
            <option value="co">CO (µg/m³)</option>
            <option value="usAqi">US AQI</option>
          </select>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900">
          {[1, 3, 7].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onDaysChange(d)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md ${
                days === d
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {d === 1 ? '24 Hours' : `${d} Days`}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900">
          {(
            [
              ['all', 'All Sources'],
              ['observed', 'Observed Sensors'],
              ['modeled', 'Modeled Grid'],
            ] as const
          ).map(([val, lbl]) => (
            <button
              key={val}
              type="button"
              onClick={() => setSourceFilter(val)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md ${
                sourceFilter === val
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* Main Trend Chart */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] p-5">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-3">
          {pollutant.toUpperCase()} Time-Series ({days}d Window)
        </h2>
        <TimeSeriesTelemetryChart
          data={trendData}
          unit={unitLabel}
          observedLabel={`Modeled ${pollutant.toUpperCase()} (Open-Meteo)`}
        />
      </div>

      {/* Daily Averages + Weather Correlation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] p-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">
            Daily Mean Comparison ({unitLabel})
          </h2>
          <BarDistributionChart items={dailyAverages} unit={unitLabel} />
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] p-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Weather vs {pollutant.toUpperCase()} Correlation
            </h2>
            <select
              value={weatherAxis}
              onChange={(e) =>
                setWeatherAxis(e.target.value as 'windSpeed' | 'humidity' | 'temperature')
              }
              className="px-2 py-1 rounded-md border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
            >
              <option value="windSpeed">Wind Speed (km/h)</option>
              <option value="humidity">Humidity (%)</option>
              <option value="temperature">Temperature (°C)</option>
            </select>
          </div>
          <ScatterCorrelationChart
            points={scatterPoints}
            xLabel={
              weatherAxis === 'windSpeed'
                ? 'Wind Speed (km/h)'
                : weatherAxis === 'humidity'
                  ? 'Humidity (%)'
                  : 'Temperature (°C)'
            }
            yLabel={`${pollutant.toUpperCase()} (${unitLabel})`}
          />
        </div>
      </div>

      {/* Highest & Lowest Pollution Locations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] p-5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
            Highest Pollution Locations ({pollutant.toUpperCase()})
          </h3>
          {combinedStations.highest.length === 0 ? (
            <div className="text-xs text-slate-500">No stations matching filter.</div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {combinedStations.highest.map((st) => (
                <div key={st.id} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-medium text-slate-900 dark:text-slate-100">{st.name}</div>
                    <div className="text-slate-500">
                      {st.provider} · {st.sourceType}
                    </div>
                  </div>
                  <div className="font-mono tabular-nums font-semibold text-amber-600 dark:text-amber-400">
                    {formatMetric(pollutant === 'usAqi' ? st.us_aqi : st[pollutant])} {unitLabel}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] p-5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
            Lowest Pollution Locations ({pollutant.toUpperCase()})
          </h3>
          {combinedStations.lowest.length === 0 ? (
            <div className="text-xs text-slate-500">No stations matching filter.</div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {combinedStations.lowest.map((st) => (
                <div key={st.id} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-medium text-slate-900 dark:text-slate-100">{st.name}</div>
                    <div className="text-slate-500">
                      {st.provider} · {st.sourceType}
                    </div>
                  </div>
                  <div className="font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                    {formatMetric(pollutant === 'usAqi' ? st.us_aqi : st[pollutant])} {unitLabel}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

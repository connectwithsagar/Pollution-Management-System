import React, { useMemo, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { downloadCsv, exportPollutionSummaryPdf } from '../services/exportUtils.ts';
import {
  formatMetric,
  type ActiveLocation,
  type AirQualityReading,
  type HourlyPoint,
} from '../types/env.ts';

export function HistoricalDataPage({
  location,
  current,
  history,
  days,
  onDaysChange,
}: {
  location: ActiveLocation;
  current: AirQualityReading | null;
  history: HourlyPoint[];
  days: number;
  onDaysChange: (d: number) => void;
}) {
  const [dateFilter, setDateFilter] = useState('');

  const filteredRows = useMemo(() => {
    const reversed = [...history].reverse();
    if (!dateFilter) return reversed;
    return reversed.filter((r) => r.timestamp.startsWith(dateFilter));
  }, [history, dateFilter]);

  const summary = useMemo(() => {
    const pm25Vals = filteredRows
      .map((r) => r.pm2_5)
      .filter((v): v is number => v !== null && v !== undefined);
    if (pm25Vals.length === 0) return null;
    const min = Math.min(...pm25Vals);
    const max = Math.max(...pm25Vals);
    const mean = pm25Vals.reduce((a, b) => a + b, 0) / pm25Vals.length;
    return { min, max, mean, count: pm25Vals.length };
  }, [filteredRows]);

  const handleCsv = () => {
    downloadCsv(
      `AetherGrid_History_${location.name.replace(/\s+/g, '_')}.csv`,
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
        'so2_ugm3',
        'co_ugm3',
        'temperature_c',
        'humidity_pct',
        'wind_speed_kmh',
      ],
      filteredRows.map((r) => [
        r.timestamp,
        r.provider,
        r.sourceType,
        r.usAqi,
        r.euAqi,
        r.pm2_5,
        r.pm10,
        r.no2,
        r.o3,
        r.so2,
        r.co,
        r.temperature,
        r.humidity,
        r.windSpeed,
      ])
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
            Historical Environmental Archive
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Hourly atmospheric reanalysis & weather telemetry for {location.name}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Download className="w-3.5 h-3.5 text-cyan-500" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={() =>
              exportPollutionSummaryPdf({
                title: 'Historical Archive Summary',
                locationName: location.name,
                lat: location.lat,
                lon: location.lon,
                current,
                hourly: filteredRows.slice().reverse(),
              })
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Download PDF</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900">
            {[1, 3, 7, 14].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => onDaysChange(d)}
                className={`px-3 py-1 text-xs font-medium rounded-md ${
                  days === d
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {d === 1 ? '24h' : `${d}d`}
              </button>
            ))}
          </div>

          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            aria-label="Filter by UTC date"
            className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-mono"
          />
          {dateFilter && (
            <button
              type="button"
              onClick={() => setDateFilter('')}
              className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
            >
              Clear Date
            </button>
          )}
        </div>

        {summary && (
          <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
            PM2.5 Summary ({summary.count}h): Min {summary.min.toFixed(1)} · Mean{' '}
            {summary.mean.toFixed(1)} · Max {summary.max.toFixed(1)} µg/m³
          </div>
        )}
      </div>

      {/* Tabular Grid */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] overflow-hidden">
        <div className="overflow-x-auto max-h-[540px]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Timestamp (UTC)</th>
                <th className="px-3 py-2.5 text-left font-medium">Source</th>
                <th className="px-3 py-2.5 text-right font-medium">US AQI</th>
                <th className="px-3 py-2.5 text-right font-medium">PM2.5</th>
                <th className="px-3 py-2.5 text-right font-medium">PM10</th>
                <th className="px-3 py-2.5 text-right font-medium">NO2</th>
                <th className="px-3 py-2.5 text-right font-medium">O3</th>
                <th className="px-3 py-2.5 text-right font-medium">Temp (°C)</th>
                <th className="px-4 py-2.5 text-right font-medium">Wind (km/h)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
              {filteredRows.slice(0, 200).map((row) => (
                <tr
                  key={row.timestamp}
                  className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors"
                >
                  <td className="px-4 py-2 text-slate-800 dark:text-slate-200">
                    {row.timestamp.slice(0, 16).replace('T', ' ')}
                  </td>
                  <td className="px-3 py-2 font-sans text-slate-500">{row.provider}</td>
                  <td className="px-3 py-2 text-right">{row.usAqi ?? 'N/A'}</td>
                  <td className="px-3 py-2 text-right">{formatMetric(row.pm2_5)}</td>
                  <td className="px-3 py-2 text-right">{formatMetric(row.pm10)}</td>
                  <td className="px-3 py-2 text-right">{formatMetric(row.no2)}</td>
                  <td className="px-3 py-2 text-right">{formatMetric(row.o3)}</td>
                  <td className="px-3 py-2 text-right">{formatMetric(row.temperature)}</td>
                  <td className="px-4 py-2 text-right">{formatMetric(row.windSpeed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

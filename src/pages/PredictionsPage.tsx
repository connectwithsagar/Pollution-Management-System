import React from 'react';
import { Cpu, RefreshCw } from 'lucide-react';
import { TimeSeriesTelemetryChart, type SeriesPoint } from '../components/Charts.tsx';
import {
  formatTimeAgo,
  type ActiveLocation,
  type ForecastResponse,
  type HourlyPoint,
} from '../types/env.ts';

export function PredictionsPage({
  location,
  history,
  forecast,
  target,
  horizon,
  loading,
  onChangeTarget,
  onChangeHorizon,
  onRetrain,
}: {
  location: ActiveLocation;
  history: HourlyPoint[];
  forecast: ForecastResponse | null;
  target: string;
  horizon: number;
  loading: boolean;
  onChangeTarget: (t: string) => void;
  onChangeHorizon: (h: number) => void;
  onRetrain: () => void;
}) {
  const unit = target === 'usAqi' ? 'AQI' : 'µg/m³';

  const chartSeries: SeriesPoint[] = [
    ...history.slice(-36).map((pt) => ({
      label: pt.timestamp.slice(5, 16).replace('T', ' '),
      timestamp: pt.timestamp,
      observed:
        target === 'usAqi'
          ? pt.usAqi
          : target === 'pm10'
            ? pt.pm10
            : target === 'no2'
              ? pt.no2
              : target === 'o3'
                ? pt.o3
                : pt.pm2_5,
      forecast: null,
    })),
    ...(forecast?.status === 'ready'
      ? forecast.predictions.map((fp) => ({
          label: fp.timestamp.slice(5, 16).replace('T', ' '),
          timestamp: fp.timestamp,
          observed: null,
          forecast: fp.predictedValue,
          lower: fp.lowerBound,
          upper: fp.upperBound,
        }))
      : []),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
            AI Pollution Forecasting Engine
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Python 3.10 Bagged Random Forest Regressor trained chronologically on real 7-day air quality & weather observations for {location.name}.
          </p>
        </div>

        <button
          type="button"
          onClick={onRetrain}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white text-xs font-medium whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Training Model...' : 'Retrain Model & Predict'}</span>
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526]">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500 dark:text-slate-400">Target Variable:</span>
          <select
            value={target}
            onChange={(e) => onChangeTarget(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
          >
            <option value="pm2_5">PM2.5 (µg/m³)</option>
            <option value="pm10">PM10 (µg/m³)</option>
            <option value="no2">NO2 (µg/m³)</option>
            <option value="o3">O3 (µg/m³)</option>
            <option value="usAqi">US AQI</option>
          </select>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500 dark:text-slate-400">Forecast Horizon:</span>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900">
            {[1, 6, 24].map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => onChangeHorizon(h)}
                className={`px-3 py-1 rounded-md text-xs font-medium ${
                  horizon === h
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                +{h}h
              </button>
            ))}
          </div>
        </div>

        {forecast?.trainedAt && (
          <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 ml-auto">
            Model {forecast.modelVersion} · Trained {formatTimeAgo(forecast.trainedAt)}
          </div>
        )}
      </div>

      {forecast?.status !== 'ready' ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-6 text-sm text-amber-700 dark:text-amber-300">
          <div className="font-semibold mb-1">AI Forecast Unavailable</div>
          <p className="text-xs">
            {forecast?.reason || 'Model is initializing or historical observations are insufficient.'}
          </p>
        </div>
      ) : (
        <>
          {/* Horizon Snapshot Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(
              [
                ['+1 Hour Forecast', forecast.horizonSnapshots?.['1h']],
                ['+6 Hour Forecast', forecast.horizonSnapshots?.['6h']],
                ['+24 Hour Forecast', forecast.horizonSnapshots?.['24h']],
              ] as const
            ).map(([title, snap]) => (
              <div
                key={title}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] p-5"
              >
                <div className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                  AI-Predicted · {title}
                </div>
                {snap ? (
                  <>
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="text-3xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {snap.predictedValue.toFixed(1)}
                      </span>
                      <span className="text-xs font-mono text-slate-500">{unit}</span>
                    </div>
                    <div className="mt-2 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      90% Interval: [{snap.lowerBound.toFixed(1)}, {snap.upperBound.toFixed(1)}] · Confidence{' '}
                      {snap.confidencePct}%
                    </div>
                  </>
                ) : (
                  <div className="mt-3 text-xs text-slate-500">
                    Select +24h horizon to compute this step.
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Trajectory Chart */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] p-5">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-3">
              Chronological History vs AI Random Forest Forecast ({target.toUpperCase()})
            </h2>
            <TimeSeriesTelemetryChart
              data={chartSeries}
              unit={unit}
              observedLabel="Historical Modeled Observations"
              forecastLabel={`AI Random Forest (${forecast.modelVersion})`}
            />
          </div>

          {/* Evaluation Metrics & Feature Importances */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-cyan-500" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Held-Out Chronological Evaluation (No Future Leakage)
                </h3>
              </div>

              <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                Train: {forecast.splits?.trainSamples} samples · Validation:{' '}
                {forecast.splits?.validationSamples} · Test: {forecast.splits?.testSamples}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                      <th className="py-2 text-left font-medium">Model / Split</th>
                      <th className="py-2 text-right font-medium">MAE</th>
                      <th className="py-2 text-right font-medium">RMSE</th>
                      <th className="py-2 text-right font-medium">R²</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
                    <tr>
                      <td className="py-2.5 font-sans">Random Forest (Validation)</td>
                      <td className="py-2.5 text-right">{forecast.metrics?.validation.mae ?? 'N/A'}</td>
                      <td className="py-2.5 text-right">{forecast.metrics?.validation.rmse ?? 'N/A'}</td>
                      <td className="py-2.5 text-right">{forecast.metrics?.validation.r2 ?? 'N/A'}</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 font-sans font-semibold text-cyan-600 dark:text-cyan-400">
                        Random Forest (Test Set)
                      </td>
                      <td className="py-2.5 text-right font-semibold">
                        {forecast.metrics?.test.mae ?? 'N/A'}
                      </td>
                      <td className="py-2.5 text-right font-semibold">
                        {forecast.metrics?.test.rmse ?? 'N/A'}
                      </td>
                      <td className="py-2.5 text-right font-semibold">
                        {forecast.metrics?.test.r2 ?? 'N/A'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 font-sans text-slate-500">Persistence Baseline (Test)</td>
                      <td className="py-2.5 text-right text-slate-500">
                        {forecast.metrics?.baselinePersistenceTest.mae ?? 'N/A'}
                      </td>
                      <td className="py-2.5 text-right text-slate-500">
                        {forecast.metrics?.baselinePersistenceTest.rmse ?? 'N/A'}
                      </td>
                      <td className="py-2.5 text-right text-slate-500">
                        {forecast.metrics?.baselinePersistenceTest.r2 ?? 'N/A'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {forecast.artifactFile && (
                <div className="text-[11px] font-mono text-slate-500">
                  Saved Model Artifact: ai/artifacts/{forecast.artifactFile}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] p-5">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
                Top Feature Importances
              </h3>
              <div className="space-y-2.5">
                {(forecast.featureImportances ?? []).map((fi) => (
                  <div key={fi.feature} className="space-y-1">
                    <div className="flex justify-between text-xs font-mono tabular-nums">
                      <span className="text-slate-700 dark:text-slate-300">{fi.feature}</span>
                      <span className="text-slate-500">{(fi.importance * 100).toFixed(1)}%</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-cyan-500 rounded-full"
                        style={{ width: `${Math.min(100, fi.importance * 100 * 2.2)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

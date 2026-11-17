import React, { useState } from 'react';
import { Bell, Check, Plus, Trash2, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.tsx';
import { formatTimeAgo, type ActiveLocation, type AlertMetric } from '../types/env.ts';

export function AlertsPage({
  location,
  onRequireAuth,
}: {
  location: ActiveLocation;
  onRequireAuth: () => void;
}) {
  const {
    user,
    alertRules,
    alerts,
    createAlertRule,
    toggleAlertRule,
    deleteAlertRule,
    updateAlertStatus,
  } = useAuth();

  const [metric, setMetric] = useState<AlertMetric>('pm2_5');
  const [threshold, setThreshold] = useState(35);
  const [emailNotify, setEmailNotify] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      onRequireAuth();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createAlertRule({
        locationName: location.name,
        lat: location.lat,
        lon: location.lon,
        metric,
        threshold,
        enabled: true,
        emailNotify,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed creating alert rule.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 dark:border-slate-800 pb-4">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          Alerts & Threshold Notifications
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Configure pollutant thresholds for monitored locations. Alerts are deduplicated across refresh cycles and carry explicit source verification.
        </p>
      </div>

      {!user && (
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-700 dark:text-slate-200">
            Sign in to create persistent threshold alert rules and receive real-time WebSocket notifications.
          </div>
          <button
            type="button"
            onClick={onRequireAuth}
            className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium"
          >
            Sign In / Register
          </button>
        </div>
      )}

      {/* New Alert Rule Builder */}
      <form
        onSubmit={handleCreateRule}
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] p-5 space-y-4"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <Plus className="w-4 h-4 text-cyan-500" />
          <span>Create Threshold Rule for {location.name}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
              Pollutant / Index
            </label>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as AlertMetric)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
            >
              <option value="pm2_5">PM2.5 (µg/m³)</option>
              <option value="pm10">PM10 (µg/m³)</option>
              <option value="us_aqi">US AQI</option>
              <option value="eu_aqi">EU AQI</option>
              <option value="no2">NO2 (µg/m³)</option>
              <option value="o3">O3 (µg/m³)</option>
              <option value="so2">SO2 (µg/m³)</option>
              <option value="co">CO (µg/m³)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
              Trigger Threshold (&ge;)
            </label>
            <input
              type="number"
              min={1}
              step="0.5"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-mono tabular-nums"
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 py-2">
            <input
              type="checkbox"
              checked={emailNotify}
              onChange={(e) => setEmailNotify(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-700"
            />
            <span>Email alerts when provider configured</span>
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium"
          >
            {submitting ? 'Saving...' : 'Add Alert Rule'}
          </button>
        </div>

        {error && <div className="text-xs text-rose-500">{error}</div>}
      </form>

      {/* Active Rules + Triggered History */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] p-5">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
            Configured Alert Rules ({alertRules.length})
          </h2>

          {alertRules.length === 0 ? (
            <div className="text-xs text-slate-500 py-6 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
              No threshold rules configured yet.
            </div>
          ) : (
            <div className="space-y-2.5">
              {alertRules.map((rule) => (
                <div
                  key={rule.id}
                  className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2"
                >
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {rule.locationName}
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {rule.metric.toUpperCase()} &ge; {rule.threshold}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        setError(null);
                        try {
                          await toggleAlertRule(rule.id, !rule.enabled);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Failed updating alert rule.');
                        }
                      }}
                      className={`px-2.5 py-1 rounded text-[11px] font-medium ${
                        rule.enabled
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                      }`}
                    >
                      {rule.enabled ? 'Enabled' : 'Paused'}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        setError(null);
                        try {
                          await deleteAlertRule(rule.id);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Failed deleting alert rule.');
                        }
                      }}
                      aria-label="Delete rule"
                      className="p-1 text-slate-400 hover:text-rose-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] p-5">
          <div className="flex items-center gap-2 mb-3">
            <Bell className="w-4 h-4 text-amber-500" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Alert History ({alerts.length})
            </h2>
          </div>

          {alerts.length === 0 ? (
            <div className="text-xs text-slate-500 py-8 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
              No threshold exceedances triggered yet.
            </div>
          ) : (
            <div className="space-y-2.5 max-h-96 overflow-y-auto">
              {alerts.map((alt) => (
                <div
                  key={alt.id}
                  className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3"
                >
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      <span
                        className={
                          alt.severity === 'critical'
                            ? 'text-rose-500 font-semibold'
                            : alt.severity === 'high'
                              ? 'text-orange-500 font-semibold'
                              : 'text-amber-500 font-semibold'
                        }
                      >
                        {alt.severity.toUpperCase()}
                      </span>{' '}
                      · {alt.sourceType} ({alt.sourceLabel}) · {formatTimeAgo(alt.triggeredAt)}
                    </div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                      {alt.locationName}: {alt.metric.toUpperCase()} reached{' '}
                      <span className="font-mono tabular-nums">{alt.observedValue}</span> (threshold{' '}
                      <span className="font-mono tabular-nums">{alt.threshold}</span>)
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs">
                    {alt.status === 'active' ? (
                      <>
                        <button
                          type="button"
                          onClick={async () => {
                            setError(null);
                            try {
                              await updateAlertStatus(alt.id, 'acknowledged');
                            } catch (err) {
                              setError(
                                err instanceof Error ? err.message : 'Failed acknowledging alert.'
                              );
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Check className="w-3 h-3 text-emerald-500" />
                          <span>Acknowledge</span>
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            setError(null);
                            try {
                              await updateAlertStatus(alt.id, 'dismissed');
                            } catch (err) {
                              setError(
                                err instanceof Error ? err.message : 'Failed dismissing alert.'
                              );
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
                        >
                          <X className="w-3 h-3" />
                          <span>Dismiss</span>
                        </button>
                      </>
                    ) : (
                      <span className="text-xs text-slate-500 capitalize">{alt.status}</span>
                    )}
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

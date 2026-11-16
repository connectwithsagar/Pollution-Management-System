import React, { useState } from 'react';
import { Bookmark, MapPin, Star, Trash2 } from 'lucide-react';
import { api } from '../services/api.ts';
import { useAuth } from '../hooks/useAuth.tsx';
import {
  formatMetric,
  getAqiCategory,
  type ActiveLocation,
  type AirQualityReading,
  type AqiStandard,
  type NavPageId,
} from '../types/env.ts';

export function SavedLocationsPage({
  standard,
  onSelectLocation,
  onNavigate,
  onRequireAuth,
}: {
  standard: AqiStandard;
  onSelectLocation: (loc: ActiveLocation) => void;
  onNavigate: (page: NavPageId) => void;
  onRequireAuth: () => void;
}) {
  const {
    user,
    savedLocations,
    markers,
    setPrimaryLocation,
    deleteSavedLocation,
    deleteMarker,
  } = useAuth();
  const [comparisons, setComparisons] = useState<Record<string, AirQualityReading>>({});
  const [comparing, setComparing] = useState(false);

  const loadComparisons = async () => {
    setComparing(true);
    try {
      const entries = await Promise.all(
        savedLocations.map(async (loc) => {
          const data = await api.getCurrentAirQuality(loc.lat, loc.lon, loc.name);
          return [loc.id, data] as const;
        })
      );
      setComparisons(Object.fromEntries(entries));
    } finally {
      setComparing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
            Saved Locations & Custom Markers
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Manage bookmarked cities and private map markers persisted to your account.
          </p>
        </div>

        {savedLocations.length > 0 && (
          <button
            type="button"
            onClick={loadComparisons}
            disabled={comparing}
            className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium"
          >
            {comparing ? 'Fetching Readings...' : 'Compare Live Air Quality'}
          </button>
        )}
      </div>

      {!user ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] p-8 text-center space-y-3">
          <Bookmark className="w-7 h-7 text-cyan-500 mx-auto" />
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Sign in to view your saved locations and custom markers
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Your saved cities and manually placed map markers remain private to your account across refreshes and devices.
          </p>
          <button
            type="button"
            onClick={onRequireAuth}
            className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium"
          >
            Sign In / Register
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Saved Cities */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Saved Cities & Coordinates ({savedLocations.length})
            </h2>
            {savedLocations.length === 0 ? (
              <div className="p-6 rounded-xl border border-dashed border-slate-300 dark:border-slate-800 text-xs text-slate-500 text-center">
                No saved locations yet. Use Location Search or Overview to bookmark a city.
              </div>
            ) : (
              savedLocations.map((loc) => {
                const cmp = comparisons[loc.id];
                const aqiVal = cmp
                  ? standard === 'EU_AQI'
                    ? cmp.pollutants.euAqi
                    : cmp.pollutants.usAqi
                  : null;
                const cat = getAqiCategory(aqiVal, standard);

                return (
                  <div
                    key={loc.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] p-4 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="text-xs text-slate-500">
                        {loc.isPrimary ? 'Primary Location · ' : ''}
                        {[loc.region, loc.country].filter(Boolean).join(', ') || 'Coordinates'}
                      </div>
                      <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
                        {loc.name}
                      </div>
                      <div className="text-xs font-mono tabular-nums text-slate-500">
                        {loc.lat.toFixed(4)}, {loc.lon.toFixed(4)}
                      </div>
                      {cmp && (
                        <div className="mt-2 text-xs font-mono tabular-nums">
                          <span className="font-semibold" style={{ color: cat.colorHex }}>
                            AQI {aqiVal ?? 'N/A'} ({cat.label})
                          </span>{' '}
                          · PM2.5 {formatMetric(cmp.pollutants.pm2_5)} µg/m³
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setPrimaryLocation(loc.id)}
                        title="Set as primary location"
                        className={`p-2 rounded-lg border border-slate-200 dark:border-slate-700 ${
                          loc.isPrimary ? 'text-amber-500' : 'text-slate-400 hover:text-amber-500'
                        }`}
                      >
                        <Star className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectLocation({
                            name: loc.name,
                            country: loc.country,
                            region: loc.region,
                            lat: loc.lat,
                            lon: loc.lon,
                          });
                          onNavigate('overview');
                        }}
                        className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium"
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteSavedLocation(loc.id)}
                        aria-label={`Remove ${loc.name}`}
                        className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-rose-500"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Private Custom Map Markers */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Private Custom Map Markers ({markers.length})
            </h2>
            {markers.length === 0 ? (
              <div className="p-6 rounded-xl border border-dashed border-slate-300 dark:border-slate-800 text-xs text-slate-500 text-center">
                No custom markers saved yet. Open the Live Pollution Map and click &ldquo;Add Marker&rdquo;.
              </div>
            ) : (
              markers.map((cm) => (
                <div
                  key={cm.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] p-4 flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="text-xs text-cyan-600 dark:text-cyan-400 capitalize">
                      {cm.markerType.replace('_', ' ')}
                    </div>
                    <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
                      {cm.name}
                    </div>
                    {cm.description && (
                      <div className="text-xs text-slate-500 mt-0.5">{cm.description}</div>
                    )}
                    <div className="text-xs font-mono tabular-nums text-slate-500 mt-1">
                      {cm.lat.toFixed(5)}, {cm.lon.toFixed(5)}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectLocation({
                          name: cm.name,
                          lat: cm.lat,
                          lon: cm.lon,
                        });
                        onNavigate('map');
                      }}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium"
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      <span>Locate</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMarker(cm.id)}
                      aria-label={`Delete ${cm.name}`}
                      className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-rose-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

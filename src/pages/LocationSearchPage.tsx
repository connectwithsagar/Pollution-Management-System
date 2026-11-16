import React, { useState } from 'react';
import { Bookmark, MapPin, Search } from 'lucide-react';
import { api } from '../services/api.ts';
import {
  formatMetric,
  getAqiCategory,
  type ActiveLocation,
  type AirQualityReading,
  type AqiStandard,
  type GeocodingResult,
  type NavPageId,
} from '../types/env.ts';

export function LocationSearchPage({
  standard,
  onSelectLocation,
  onSaveLocation,
  onNavigate,
}: {
  standard: AqiStandard;
  onSelectLocation: (loc: ActiveLocation) => void;
  onSaveLocation: (loc: {
    name: string;
    country: string;
    region: string;
    lat: number;
    lon: number;
  }) => Promise<void>;
  onNavigate: (page: NavPageId) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [attribution, setAttribution] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewMap, setPreviewMap] = useState<Record<string, AirQualityReading>>({});

  const runSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true);
    setError(null);
    try {
      const res = await api.searchLocations(query.trim());
      setResults(res.results);
      setAttribution(res.attribution);
      if (res.error) setError(res.error);
      if (res.results.length === 0 && !res.error) {
        setError(`No matching locations found for "${query.trim()}".`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Location search failed.');
    } finally {
      setSearching(false);
    }
  };

  const loadPreview = async (item: GeocodingResult) => {
    try {
      const aq = await api.getCurrentAirQuality(item.lat, item.lon, item.name);
      setPreviewMap((prev) => ({ ...prev, [item.id]: aq }));
    } catch {
      // ignore preview error
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          Location Search & Geocoding
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Search cities, neighborhoods, street addresses, or landmarks worldwide using OpenStreetMap Nominatim and Open-Meteo Geocoding.
        </p>
      </div>

      <form onSubmit={runSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search city, district, address, or landmark (e.g., Tokyo, Berlin Mitte, Golden Gate Park)..."
            className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D1526] focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
        </div>
        <button
          type="submit"
          disabled={searching}
          className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium whitespace-nowrap shrink-0"
        >
          {searching ? 'Searching...' : 'Search'}
        </button>
      </form>

      {error && (
        <div className="p-3.5 rounded-xl border border-amber-500/40 bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300">
          {error}
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          {results.map((item) => {
            const preview = previewMap[item.id];
            const aqiVal = preview
              ? standard === 'EU_AQI'
                ? preview.pollutants.euAqi
                : preview.pollutants.usAqi
              : null;
            const cat = getAqiCategory(aqiVal, standard);

            return (
              <div
                key={item.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] p-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {item.provider} · {item.type}
                  </div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    {item.name}
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400">{item.displayName}</p>
                  <div className="text-xs font-mono tabular-nums text-slate-500">
                    {item.lat.toFixed(5)}, {item.lon.toFixed(5)}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {preview ? (
                    <div className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-mono tabular-nums mr-2">
                      <span className="font-semibold" style={{ color: cat.colorHex }}>
                        AQI {aqiVal ?? 'N/A'}
                      </span>{' '}
                      · PM2.5 {formatMetric(preview.pollutants.pm2_5)} µg/m³
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => loadPreview(item)}
                      className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                    >
                      Check Air Quality
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      onSaveLocation({
                        name: item.name,
                        country: item.country,
                        region: item.region,
                        lat: item.lat,
                        lon: item.lon,
                      })
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                  >
                    <Bookmark className="w-3.5 h-3.5 text-cyan-500" />
                    <span>Save</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onSelectLocation({
                        name: item.name,
                        country: item.country,
                        region: item.region,
                        lat: item.lat,
                        lon: item.lon,
                      });
                      onNavigate('map');
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium whitespace-nowrap"
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    <span>View on Map</span>
                  </button>
                </div>
              </div>
            );
          })}

          {attribution && (
            <div className="text-xs text-slate-500 dark:text-slate-400 pt-2">
              Geocoding attribution: {attribution}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

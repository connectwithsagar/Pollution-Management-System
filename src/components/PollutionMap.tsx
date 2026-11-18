import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  APILoadingStatus,
  APIProvider,
  AdvancedMarker,
  Circle,
  ColorScheme,
  InfoWindow,
  Map as GoogleMap,
  useApiLoadingStatus,
  useMap,
  useMapsLibrary,
  type AdvancedMarkerRef,
} from '@vis.gl/react-google-maps';
import { MarkerClusterer, type Cluster } from '@googlemaps/markerclusterer';
import {
  Crosshair,
  Edit3,
  Layers,
  MapPin,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../services/api.ts';
import { useAuth } from '../hooks/useAuth.tsx';
import {
  formatMetric,
  formatTimeAgo,
  getAqiCategory,
  type ActiveLocation,
  type AirQualityReading,
  type AqiStandard,
  type CustomMarker,
  type HotspotCluster,
  type MarkerType,
  type StationNode,
} from '../types/env.ts';

const MARKER_TYPE_LABELS: Record<MarkerType, string> = {
  home: 'Home',
  school: 'School',
  factory: 'Factory',
  hospital: 'Hospital',
  monitoring_point: 'Monitoring Point',
};

const MARKER_TYPE_COLORS: Record<MarkerType, string> = {
  home: '#06b6d4',
  school: '#10b981',
  factory: '#f59e0b',
  hospital: '#ef4444',
  monitoring_point: '#38bdf8',
};

const DEMO_MAP_ID = 'DEMO_MAP_ID';

function StationPinContent({
  color,
  label,
  ringColor = '#ffffff',
}: {
  color: string;
  label: string;
  ringColor?: string;
}) {
  return (
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: 9999,
        background: color,
        border: `2px solid ${ringColor}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#ffffff',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 10,
        fontWeight: 600,
        boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
        cursor: 'pointer',
      }}
    >
      {label}
    </div>
  );
}

function CustomDiamondPin({
  type,
  isDraft = false,
}: {
  type: MarkerType;
  isDraft?: boolean;
}) {
  const color = MARKER_TYPE_COLORS[type] || '#06b6d4';
  const short = type.slice(0, 1).toUpperCase();
  return (
    <div
      style={{
        width: 30,
        height: 30,
        borderRadius: 8,
        transform: 'rotate(45deg)',
        background: color,
        border: `2px solid ${isDraft ? '#fde047' : '#ffffff'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 3px 10px rgba(0,0,0,0.45)',
        cursor: isDraft ? 'grab' : 'pointer',
      }}
    >
      <span
        style={{
          transform: 'rotate(-45deg)',
          color: '#070b14',
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        {short}
      </span>
    </div>
  );
}

function MapStatusMonitor({
  onError,
}: {
  onError: (msg: string | null) => void;
}) {
  const status = useApiLoadingStatus();

  useEffect(() => {
    if (status === APILoadingStatus.AUTH_FAILURE) {
      window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      onError('Google Maps authentication or quota limit reached.');
    } else if (status === APILoadingStatus.FAILED) {
      onError('Failed to load Google Maps JavaScript API.');
    } else if (status === APILoadingStatus.LOADED) {
      onError(null);
    }
  }, [status, onError]);

  return null;
}

function MapController({
  activeLocation,
  addingMode,
  focusTarget,
}: {
  activeLocation: ActiveLocation;
  addingMode: boolean;
  focusTarget: { lat: number; lon: number; zoom?: number; seq: number } | null;
}) {
  const map = useMap();
  const lastCenteredRef = useRef<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    if (!map) return;
    map.setOptions({
      draggableCursor: addingMode ? 'crosshair' : undefined,
    });
    return () => {
      try {
        map.setOptions({ draggableCursor: undefined });
      } catch {
        // ignore cleanup on unmount
      }
    };
  }, [map, addingMode]);

  useEffect(() => {
    if (!map) return;
    if (!Number.isFinite(activeLocation.lat) || !Number.isFinite(activeLocation.lon)) return;

    const prev = lastCenteredRef.current;
    if (
      prev &&
      Math.abs(prev.lat - activeLocation.lat) < 1e-5 &&
      Math.abs(prev.lon - activeLocation.lon) < 1e-5
    ) {
      return;
    }

    lastCenteredRef.current = { lat: activeLocation.lat, lon: activeLocation.lon };
    map.panTo({ lat: activeLocation.lat, lng: activeLocation.lon });
    const currentZoom = map.getZoom();
    if (typeof currentZoom === 'number' && currentZoom < 11) {
      map.setZoom(11);
    }
  }, [map, activeLocation.lat, activeLocation.lon]);

  useEffect(() => {
    if (!map || !focusTarget) return;
    if (!Number.isFinite(focusTarget.lat) || !Number.isFinite(focusTarget.lon)) return;
    map.panTo({ lat: focusTarget.lat, lng: focusTarget.lon });
    if (typeof focusTarget.zoom === 'number') {
      map.setZoom(focusTarget.zoom);
    }
  }, [map, focusTarget]);

  return null;
}

function ClusteredStationMarkers({
  stations,
  visible,
  standard,
  onSelectStation,
}: {
  stations: StationNode[];
  visible: boolean;
  standard: AqiStandard;
  onSelectStation: (station: StationNode) => void;
}) {
  const map = useMap();
  const markerLib = useMapsLibrary('marker');
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const onSelectRef = useRef(onSelectStation);

  useEffect(() => {
    onSelectRef.current = onSelectStation;
  }, [onSelectStation]);

  useEffect(() => {
    if (!map || !markerLib) return;

    const clusterer = new MarkerClusterer({
      map,
      renderer: {
        render: ({ count, position }: Cluster) => {
          const badge = document.createElement('div');
          badge.style.width = '34px';
          badge.style.height = '34px';
          badge.style.borderRadius = '9999px';
          badge.style.background =
            count >= 25
              ? 'rgba(220, 38, 38, 0.92)'
              : count >= 10
                ? 'rgba(217, 119, 6, 0.92)'
                : 'rgba(8, 145, 178, 0.92)';
          badge.style.border = '2px solid rgba(255, 255, 255, 0.9)';
          badge.style.display = 'flex';
          badge.style.alignItems = 'center';
          badge.style.justifyContent = 'center';
          badge.style.color = '#ffffff';
          badge.style.fontFamily = "'IBM Plex Mono', monospace";
          badge.style.fontSize = '11px';
          badge.style.fontWeight = '700';
          badge.style.boxShadow = '0 3px 10px rgba(0,0,0,0.45)';
          badge.style.cursor = 'pointer';
          badge.textContent = String(count);

          return new markerLib.AdvancedMarkerElement({
            position,
            content: badge,
            zIndex: 900 + count,
            title: `Cluster of ${count} monitoring stations`,
          });
        },
      },
    });

    clustererRef.current = clusterer;

    return () => {
      clusterer.clearMarkers();
      clustererRef.current = null;
    };
  }, [map, markerLib]);

  useEffect(() => {
    const clusterer = clustererRef.current;
    if (!clusterer || !markerLib) return;

    clusterer.clearMarkers();
    if (!visible) return;

    const listeners: Array<{ remove: () => void }> = [];
    const createdMarkers: Array<NonNullable<AdvancedMarkerRef>> = [];

    stations.forEach((st) => {
      if (!Number.isFinite(st.lat) || !Number.isFinite(st.lon)) return;
      const aqiVal = standard === 'EU_AQI' ? st.eu_aqi ?? st.us_aqi : st.us_aqi;
      const cat = getAqiCategory(aqiVal, standard);
      const label =
        typeof aqiVal === 'number' && Number.isFinite(aqiVal)
          ? String(Math.round(aqiVal))
          : typeof st.pm2_5 === 'number' && Number.isFinite(st.pm2_5)
            ? st.pm2_5.toFixed(0)
            : '•';

      const content = document.createElement('div');
      content.style.width = '28px';
      content.style.height = '28px';
      content.style.borderRadius = '9999px';
      content.style.background = cat.colorHex;
      content.style.border = '2px solid #ffffff';
      content.style.display = 'flex';
      content.style.alignItems = 'center';
      content.style.justifyContent = 'center';
      content.style.color = '#ffffff';
      content.style.fontFamily = "'IBM Plex Mono', monospace";
      content.style.fontSize = '10px';
      content.style.fontWeight = '600';
      content.style.boxShadow = '0 2px 6px rgba(0,0,0,0.4)';
      content.style.cursor = 'pointer';
      content.textContent = label;

      const advMarker = new markerLib.AdvancedMarkerElement({
        position: { lat: st.lat, lng: st.lon },
        content,
        title: `${st.name} (${st.provider})`,
      });

      const listener = advMarker.addListener('click', () => {
        onSelectRef.current(st);
      });

      listeners.push(listener);
      createdMarkers.push(advMarker);
    });

    if (createdMarkers.length > 0) {
      clusterer.addMarkers(createdMarkers);
    }

    return () => {
      listeners.forEach((l) => l.remove());
      clusterer.clearMarkers();
      createdMarkers.forEach((m) => {
        m.map = null;
      });
    };
  }, [stations, visible, standard, markerLib]);

  return null;
}

export function PollutionMap({
  activeLocation,
  onSelectLocation,
  stations,
  modeledGrid,
  iotStations,
  hotspots,
  standard,
  theme,
  onRequireAuth,
  mapHeightClass = 'h-[580px]',
}: {
  activeLocation: ActiveLocation;
  onSelectLocation: (loc: ActiveLocation) => void;
  stations: StationNode[];
  modeledGrid: StationNode[];
  iotStations: StationNode[];
  hotspots: HotspotCluster[];
  standard: AqiStandard;
  theme: 'dark' | 'light';
  onRequireAuth: () => void;
  mapHeightClass?: string;
}) {
  const { user, markers, createMarker, updateMarker, deleteMarker } = useAuth();

  const [mapsApiKey, setMapsApiKey] = useState<string>(() =>
    (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim()
  );
  const [loadingConfig, setLoadingConfig] = useState<boolean>(
    !(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim()
  );

  const [layers, setLayers] = useState({
    stations: true,
    grid: true,
    customMarkers: true,
    hotspots: true,
    iot: true,
  });

  const [addingMode, setAddingMode] = useState(false);
  const [draftCoord, setDraftCoord] = useState<{ lat: number; lon: number } | null>(null);
  const [editingMarkerId, setEditingMarkerId] = useState<string | null>(null);
  const [markerName, setMarkerName] = useState('');
  const [markerDesc, setMarkerDesc] = useState('');
  const [markerType, setMarkerType] = useState<MarkerType>('monitoring_point');
  const [formError, setFormError] = useState<string | null>(null);
  const [savingMarker, setSavingMarker] = useState(false);

  const [selectedStation, setSelectedStation] = useState<StationNode | null>(null);
  const [selectedCustomMarker, setSelectedCustomMarker] = useState<CustomMarker | null>(null);
  const [selectedHotspot, setSelectedHotspot] = useState<HotspotCluster | null>(null);
  const [markerAirData, setMarkerAirData] = useState<AirQualityReading | null>(null);
  const [loadingMarkerAir, setLoadingMarkerAir] = useState(false);
  const [geoStatus, setGeoStatus] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [initAttempt, setInitAttempt] = useState(0);
  const [focusTarget, setFocusTarget] = useState<{
    lat: number;
    lon: number;
    zoom?: number;
    seq: number;
  } | null>(null);

  // Resolve Google Maps API key from Vite env or backend runtime config
  useEffect(() => {
    const envKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
    if (envKey) {
      setMapsApiKey(envKey);
      setLoadingConfig(false);
      return;
    }

    let cancelled = false;
    setLoadingConfig(true);
    fetch('/api/maps/config')
      .then((res) => (res.ok ? res.json() : { apiKey: '' }))
      .then((data: { apiKey?: string }) => {
        if (cancelled) return;
        const key = typeof data?.apiKey === 'string' ? data.apiKey.trim() : '';
        setMapsApiKey(key);
        if (!key) {
          setMapError('Google Maps API key is not configured for this environment.');
        } else {
          setMapError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMapError('Unable to load Google Maps configuration.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingConfig(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initAttempt]);

  const initialCenter = useMemo(
    () => ({
      lat: Number.isFinite(activeLocation.lat) ? activeLocation.lat : 37.7749,
      lng: Number.isFinite(activeLocation.lon) ? activeLocation.lon : -122.4194,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme, initAttempt]
  );

  const fetchPollutionForCoordinates = useCallback(
    async (lat: number, lon: number, label: string) => {
      setLoadingMarkerAir(true);
      setMarkerAirData(null);
      try {
        const data = await api.getCurrentAirQuality(lat, lon, label);
        setMarkerAirData(data);
      } catch (err) {
        console.error('Failed fetching coordinate air quality:', err);
      } finally {
        setLoadingMarkerAir(false);
      }
    },
    []
  );

  const handleLocateMe = () => {
    const fallbackToIp = async (reason?: string) => {
      try {
        setGeoStatus('Browser GPS unavailable; resolving approximate IP location...');
        const ipLoc = await api.geolocateByIp();
        setGeoStatus(
          `${reason ? `${reason} · ` : ''}Using approximate IP location: ${ipLoc.name}`
        );
        onSelectLocation({
          name: ipLoc.name,
          region: ipLoc.region,
          country: ipLoc.country,
          lat: ipLoc.lat,
          lon: ipLoc.lon,
        });
      } catch (ipErr) {
        setGeoStatus(
          `Location access unavailable (${reason || 'denied'}). ${ipErr instanceof Error ? ipErr.message : ''}`
        );
      }
    };

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      void fallbackToIp('Geolocation unsupported');
      return;
    }

    setGeoStatus('Requesting browser location...');
    try {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = Number(pos.coords.latitude.toFixed(5));
          const lon = Number(pos.coords.longitude.toFixed(5));
          let label = 'Current Location';
          let region = '';
          let country = '';
          try {
            const rev = await api.reverseGeocode(lat, lon);
            label = rev.name || label;
            region = rev.region;
            country = rev.country;
          } catch {
            // keep generic label if reverse geocoding fails
          }
          setGeoStatus(`Located: ${label} (${lat.toFixed(4)}, ${lon.toFixed(4)})`);
          onSelectLocation({
            name: label,
            region,
            country,
            lat,
            lon,
          });
        },
        (err) => {
          void fallbackToIp(err.message || 'Permission denied');
        },
        { enableHighAccuracy: false, timeout: 6000, maximumAge: 60000 }
      );
    } catch (syncErr) {
      void fallbackToIp(syncErr instanceof Error ? syncErr.message : 'Blocked by iframe policy');
    }
  };

  const startNewMarkerMode = () => {
    if (!user) {
      onRequireAuth();
      return;
    }
    setAddingMode((prev) => !prev);
    setEditingMarkerId(null);
    setSelectedCustomMarker(null);
    setFormError(null);
  };

  const startEditingCustomMarker = (cm: CustomMarker) => {
    setAddingMode(false);
    setEditingMarkerId(cm.id);
    setDraftCoord({ lat: cm.lat, lon: cm.lon });
    setMarkerName(cm.name);
    setMarkerDesc(cm.description);
    setMarkerType(cm.markerType);
    setFormError(null);
    setFocusTarget({ lat: cm.lat, lon: cm.lon, seq: Date.now() });
  };

  const cancelDraft = () => {
    setAddingMode(false);
    setDraftCoord(null);
    setEditingMarkerId(null);
    setMarkerName('');
    setMarkerDesc('');
    setMarkerType('monitoring_point');
    setFormError(null);
  };

  const handleSaveMarker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      onRequireAuth();
      return;
    }
    if (!draftCoord) {
      setFormError('Click on the map or enter latitude and longitude first.');
      return;
    }
    if (!markerName.trim()) {
      setFormError('Marker name is required.');
      return;
    }
    if (
      !Number.isFinite(draftCoord.lat) ||
      draftCoord.lat < -90 ||
      draftCoord.lat > 90 ||
      !Number.isFinite(draftCoord.lon) ||
      draftCoord.lon < -180 ||
      draftCoord.lon > 180
    ) {
      setFormError('Latitude must be between -90 and 90, longitude between -180 and 180.');
      return;
    }

    setSavingMarker(true);
    setFormError(null);
    try {
      if (editingMarkerId) {
        await updateMarker(editingMarkerId, {
          name: markerName.trim(),
          description: markerDesc.trim(),
          markerType,
          lat: draftCoord.lat,
          lon: draftCoord.lon,
        });
      } else {
        const saved = await createMarker({
          name: markerName.trim(),
          description: markerDesc.trim(),
          markerType,
          lat: draftCoord.lat,
          lon: draftCoord.lon,
        });
        setSelectedCustomMarker(saved);
        void fetchPollutionForCoordinates(saved.lat, saved.lon, saved.name);
      }
      cancelDraft();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save marker.');
    } finally {
      setSavingMarker(false);
    }
  };

  const handleDeleteCustomMarker = async (id: string) => {
    try {
      await deleteMarker(id);
      if (selectedCustomMarker?.id === id) {
        setSelectedCustomMarker(null);
        setMarkerAirData(null);
      }
      if (editingMarkerId === id) {
        cancelDraft();
      }
    } catch (err) {
      console.error('Failed deleting marker:', err);
    }
  };

  return (
    <div className="space-y-4">
      {/* Map Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526]">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={startNewMarkerMode}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
              addingMode
                ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                : 'bg-cyan-600 text-white hover:bg-cyan-500'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{addingMode ? 'Click Map to Place Marker (Cancel)' : 'Add Marker'}</span>
          </button>

          <button
            type="button"
            onClick={handleLocateMe}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <Crosshair className="w-3.5 h-3.5 text-cyan-500" />
            <span>Locate Me</span>
          </button>

          {geoStatus && (
            <span className="text-xs text-slate-500 dark:text-slate-400">{geoStatus}</span>
          )}
        </div>

        {/* Layer Toggles */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400 mr-1">
            <Layers className="w-3.5 h-3.5" />
            <span>Layers:</span>
          </span>
          {(
            [
              ['stations', `Stations (${stations.length})`],
              ['grid', 'Modeled Grid'],
              ['customMarkers', `My Markers (${markers.length})`],
              ['hotspots', `Hotspots (${hotspots.length})`],
              ['iot', `IoT (${iotStations.length})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setLayers((prev) => ({ ...prev, [key]: !prev[key] }))}
              className={`px-2.5 py-1.5 rounded-md border text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                layers[key]
                  ? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-700 dark:text-cyan-300'
                  : 'border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Map + Side Inspector Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        <div className="lg:col-span-8 relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-[#070B14] min-h-[520px]">
          <div className={`relative w-full ${mapHeightClass} min-h-[520px]`}>
            {loadingConfig ? (
              <div className="w-full h-full flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">
                Loading Google Maps configuration...
              </div>
            ) : mapsApiKey ? (
              <APIProvider
                apiKey={mapsApiKey}
                libraries={['marker']}
                language="en"
                region="US"
                onError={(err) => {
                  console.error('Google Maps APIProvider error:', err);
                  setMapError('Unable to load Google Maps Platform SDK.');
                }}
              >
                <MapStatusMonitor onError={setMapError} />
                <GoogleMap
                  key={`${theme}-${initAttempt}`}
                  mapId={DEMO_MAP_ID}
                  defaultCenter={initialCenter}
                  defaultZoom={12}
                  colorScheme={theme === 'dark' ? ColorScheme.DARK : ColorScheme.LIGHT}
                  gestureHandling="greedy"
                  streetViewControl={false}
                  fullscreenControl
                  mapTypeControl={false}
                  internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                  style={{ width: '100%', height: '100%' }}
                  onClick={(ev) => {
                    if (addingMode && ev.detail.latLng) {
                      const lat = Number(ev.detail.latLng.lat.toFixed(6));
                      const lon = Number(ev.detail.latLng.lng.toFixed(6));
                      setDraftCoord({ lat, lon });
                      setEditingMarkerId(null);
                      setSelectedCustomMarker(null);
                      setSelectedStation(null);
                      setSelectedHotspot(null);
                      setMarkerAirData(null);
                      setFormError(null);
                      return;
                    }
                    setSelectedHotspot(null);
                  }}
                >
                  <MapController
                    activeLocation={activeLocation}
                    addingMode={addingMode}
                    focusTarget={focusTarget}
                  />

                  {/* Modeled Metro Grid Circles */}
                  {layers.grid &&
                    modeledGrid.map((cell) => {
                      if (!Number.isFinite(cell.lat) || !Number.isFinite(cell.lon)) return null;
                      const aqiVal = standard === 'EU_AQI' ? cell.eu_aqi : cell.us_aqi;
                      const cat = getAqiCategory(aqiVal, standard);
                      return (
                        <Circle
                          key={`grid-${cell.id}`}
                          center={{ lat: cell.lat, lng: cell.lon }}
                          radius={1700}
                          strokeColor={cat.colorHex}
                          strokeOpacity={0.45}
                          strokeWeight={1}
                          fillColor={cat.colorHex}
                          fillOpacity={0.16}
                          clickable
                          onClick={() => {
                            setSelectedStation(cell);
                            setSelectedCustomMarker(null);
                            setSelectedHotspot(null);
                          }}
                        />
                      );
                    })}

                  {/* DBSCAN Hotspot Circles */}
                  {layers.hotspots &&
                    hotspots.map((hs) => {
                      if (
                        !Number.isFinite(hs.centroidLat) ||
                        !Number.isFinite(hs.centroidLon) ||
                        !Number.isFinite(hs.radiusKm)
                      ) {
                        return null;
                      }
                      const color =
                        hs.severity === 'critical'
                          ? '#ef4444'
                          : hs.severity === 'high'
                            ? '#f97316'
                            : '#f59e0b';
                      return (
                        <Circle
                          key={`hotspot-${hs.id}`}
                          center={{ lat: hs.centroidLat, lng: hs.centroidLon }}
                          radius={Math.max(500, hs.radiusKm * 1000)}
                          strokeColor={color}
                          strokeOpacity={0.85}
                          strokeWeight={2}
                          fillColor={color}
                          fillOpacity={0.2}
                          clickable
                          onClick={() => setSelectedHotspot(hs)}
                        />
                      );
                    })}

                  {/* Hotspot Details InfoWindow */}
                  {selectedHotspot && (
                    <InfoWindow
                      position={{
                        lat: selectedHotspot.centroidLat,
                        lng: selectedHotspot.centroidLon,
                      }}
                      onCloseClick={() => setSelectedHotspot(null)}
                    >
                      <div className="text-xs text-slate-900 space-y-1 max-w-[220px]">
                        <div className="font-semibold">{selectedHotspot.label}</div>
                        <div>
                          Peak {selectedHotspot.pollutant.toUpperCase()}:{' '}
                          <strong>{selectedHotspot.peakValue}</strong> (Threshold:{' '}
                          {selectedHotspot.threshold})
                        </div>
                        <div>
                          Stations: {selectedHotspot.stationCount} · Severity:{' '}
                          {selectedHotspot.severity.toUpperCase()}
                        </div>
                        <div className="text-[11px] text-slate-600">
                          {selectedHotspot.isModeledSurface
                            ? 'Modeled surface cluster'
                            : 'Observed station cluster'}
                        </div>
                      </div>
                    </InfoWindow>
                  )}

                  {/* Clustered Observed Monitoring Stations (AdvancedMarkerElement + MarkerClusterer) */}
                  <ClusteredStationMarkers
                    stations={stations}
                    visible={layers.stations}
                    standard={standard}
                    onSelectStation={(st) => {
                      setSelectedStation(st);
                      setSelectedCustomMarker(null);
                      setSelectedHotspot(null);
                    }}
                  />

                  {/* ESP32 IoT Nodes */}
                  {layers.iot &&
                    iotStations.map((node) => {
                      if (!Number.isFinite(node.lat) || !Number.isFinite(node.lon)) return null;
                      const cat = getAqiCategory(node.us_aqi, standard);
                      return (
                        <AdvancedMarker
                          key={`iot-${node.id}`}
                          position={{ lat: node.lat, lng: node.lon }}
                          title={`${node.name} (ESP32 IoT)`}
                          anchorLeft="-50%"
                          anchorTop="-50%"
                          onClick={() => {
                            setSelectedStation(node);
                            setSelectedCustomMarker(null);
                            setSelectedHotspot(null);
                          }}
                        >
                          <StationPinContent color={cat.colorHex} label="IoT" ringColor="#22d3ee" />
                        </AdvancedMarker>
                      );
                    })}

                  {/* Saved Custom User Markers */}
                  {layers.customMarkers &&
                    markers.map((cm) => {
                      if (!Number.isFinite(cm.lat) || !Number.isFinite(cm.lon)) return null;
                      if (editingMarkerId === cm.id && draftCoord) return null;
                      return (
                        <AdvancedMarker
                          key={cm.id}
                          position={{ lat: cm.lat, lng: cm.lon }}
                          title={cm.name}
                          anchorLeft="-50%"
                          anchorTop="-50%"
                          onClick={() => {
                            setSelectedCustomMarker(cm);
                            setSelectedStation(null);
                            setSelectedHotspot(null);
                            void fetchPollutionForCoordinates(cm.lat, cm.lon, cm.name);
                          }}
                        >
                          <CustomDiamondPin type={cm.markerType || 'monitoring_point'} />
                        </AdvancedMarker>
                      );
                    })}

                  {/* Draggable Draft Marker */}
                  {draftCoord &&
                    Number.isFinite(draftCoord.lat) &&
                    Number.isFinite(draftCoord.lon) && (
                      <AdvancedMarker
                        position={{ lat: draftCoord.lat, lng: draftCoord.lon }}
                        draggable
                        zIndex={1000}
                        anchorLeft="-50%"
                        anchorTop="-50%"
                        title="Drag to adjust custom marker coordinates"
                        onDragEnd={(ev) => {
                          if (!ev.latLng) return;
                          const latVal =
                            typeof ev.latLng.lat === 'function'
                              ? ev.latLng.lat()
                              : Number(ev.latLng.lat);
                          const lngVal =
                            typeof ev.latLng.lng === 'function'
                              ? ev.latLng.lng()
                              : Number(ev.latLng.lng);
                          if (Number.isFinite(latVal) && Number.isFinite(lngVal)) {
                            setDraftCoord({
                              lat: Number(latVal.toFixed(6)),
                              lon: Number(lngVal.toFixed(6)),
                            });
                          }
                        }}
                      >
                        <CustomDiamondPin type={markerType} isDraft />
                      </AdvancedMarker>
                    )}
                </GoogleMap>
              </APIProvider>
            ) : null}
          </div>

          {mapError && !loadingConfig && (
            <div className="absolute inset-0 z-[600] flex items-center justify-center bg-slate-950/85 p-6 text-center">
              <div className="max-w-md space-y-3 text-xs text-rose-300">
                <div className="text-sm font-semibold text-white">Google Maps Error</div>
                <p>{mapError}</p>
                <button
                  type="button"
                  onClick={() => {
                    setMapError(null);
                    setInitAttempt((a) => a + 1);
                  }}
                  className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium"
                >
                  Retry Map Initialization
                </button>
              </div>
            </div>
          )}

          {addingMode && !draftCoord && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] px-3.5 py-2 rounded-lg bg-slate-950/90 text-slate-100 border border-cyan-500/50 text-xs shadow-lg pointer-events-none">
              Click anywhere on the map to place your custom marker, then drag to refine coordinates.
            </div>
          )}

          {/* Legend */}
          <div className="absolute bottom-3 left-3 z-[400] max-w-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-[#0D1526]/95 backdrop-blur-sm p-2.5 text-[11px] text-slate-700 dark:text-slate-300 shadow-md">
            <div className="font-semibold mb-1.5 text-slate-900 dark:text-slate-100">
              {standard === 'EU_AQI' ? 'European AQI Scale' : 'US EPA AQI Scale'} &amp; Symbols
            </div>
            <div className="grid grid-cols-3 gap-x-2 gap-y-1 mb-2">
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-[#10b981]" /> Good
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-[#06b6d4]" /> Moderate
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-[#f59e0b]" /> Sensitive
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-[#f97316]" /> Unhealthy
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-[#ef4444]" /> Very High
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-[#64748b]" /> N/A
              </span>
            </div>
            <div className="border-t border-slate-200 dark:border-slate-800 pt-1.5 text-[10px] text-slate-500 dark:text-slate-400">
              Circles: Observed Stations · Shaded Zones: Modeled Grid · Diamonds: Custom User Markers
            </div>
          </div>
        </div>

        {/* Right Side Inspector / Manual Marker Editor */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          {draftCoord ? (
            <form
              onSubmit={handleSaveMarker}
              className="rounded-xl border border-cyan-500/40 bg-white dark:bg-[#0D1526] p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {editingMarkerId ? 'Edit Custom Marker' : 'New Custom Location Marker'}
                </h3>
                <button
                  type="button"
                  onClick={cancelDraft}
                  className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                  aria-label="Cancel marker editing"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                Drag the highlighted pin on the map or edit latitude and longitude directly below.
              </p>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Latitude
                  </label>
                  <input
                    type="number"
                    step="0.000001"
                    min={-90}
                    max={90}
                    value={draftCoord.lat}
                    onChange={(e) =>
                      setDraftCoord((prev) =>
                        prev ? { ...prev, lat: Number(e.target.value) } : null
                      )
                    }
                    className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Longitude
                  </label>
                  <input
                    type="number"
                    step="0.000001"
                    min={-180}
                    max={180}
                    value={draftCoord.lon}
                    onChange={(e) =>
                      setDraftCoord((prev) =>
                        prev ? { ...prev, lon: Number(e.target.value) } : null
                      )
                    }
                    className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Marker Name
                </label>
                <input
                  type="text"
                  required
                  value={markerName}
                  onChange={(e) => setMarkerName(e.target.value)}
                  placeholder="e.g., Lincoln Elementary School"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Marker Type
                </label>
                <select
                  value={markerType}
                  onChange={(e) => setMarkerType(e.target.value as MarkerType)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                >
                  {Object.entries(MARKER_TYPE_LABELS).map(([val, lbl]) => (
                    <option key={val} value={val}>
                      {lbl}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Description / Notes
                </label>
                <textarea
                  rows={2}
                  value={markerDesc}
                  onChange={(e) => setMarkerDesc(e.target.value)}
                  placeholder="Context for monitoring this location..."
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                />
              </div>

              {formError && (
                <div className="p-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-xs text-rose-500">
                  {formError}
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={savingMarker}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{savingMarker ? 'Saving...' : editingMarkerId ? 'Save Changes' : 'Save Marker'}</span>
                </button>
                <button
                  type="button"
                  onClick={cancelDraft}
                  className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : selectedCustomMarker ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs text-cyan-600 dark:text-cyan-400 font-medium">
                    User Marker · {MARKER_TYPE_LABELS[selectedCustomMarker.markerType]}
                  </div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    {selectedCustomMarker.name}
                  </h3>
                  <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-0.5">
                    {selectedCustomMarker.lat.toFixed(5)}, {selectedCustomMarker.lon.toFixed(5)}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => startEditingCustomMarker(selectedCustomMarker)}
                    title="Edit or reposition marker"
                    className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteCustomMarker(selectedCustomMarker.id)}
                    title="Delete marker"
                    className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-rose-500 hover:bg-rose-500/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {selectedCustomMarker.description && (
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {selectedCustomMarker.description}
                </p>
              )}

              <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Coordinate Air Quality Lookup
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      fetchPollutionForCoordinates(
                        selectedCustomMarker.lat,
                        selectedCustomMarker.lon,
                        selectedCustomMarker.name
                      )
                    }
                    className="inline-flex items-center gap-1 text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
                  >
                    <RefreshCw className={`w-3 h-3 ${loadingMarkerAir ? 'animate-spin' : ''}`} />
                    <span>Refresh</span>
                  </button>
                </div>

                {loadingMarkerAir ? (
                  <div className="text-xs text-slate-500 py-4">
                    Querying environmental providers for coordinates...
                  </div>
                ) : markerAirData ? (
                  <div className="space-y-2 text-xs">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Source: {markerAirData.provider} ({markerAirData.sourceType}) · Updated{' '}
                      {formatTimeAgo(markerAirData.observedAt)}
                    </div>
                    <div className="grid grid-cols-2 gap-2 font-mono tabular-nums">
                      <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                        <div className="text-[10px] text-slate-500">US AQI / EU AQI</div>
                        <div className="text-sm font-semibold">
                          {markerAirData.pollutants.usAqi ?? 'N/A'} /{' '}
                          {markerAirData.pollutants.euAqi ?? 'N/A'}
                        </div>
                      </div>
                      <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                        <div className="text-[10px] text-slate-500">PM2.5 / PM10</div>
                        <div className="text-sm font-semibold">
                          {formatMetric(markerAirData.pollutants.pm2_5)} /{' '}
                          {formatMetric(markerAirData.pollutants.pm10)}
                        </div>
                      </div>
                      <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                        <div className="text-[10px] text-slate-500">NO2 / O3</div>
                        <div className="text-sm font-semibold">
                          {formatMetric(markerAirData.pollutants.no2)} /{' '}
                          {formatMetric(markerAirData.pollutants.o3)}
                        </div>
                      </div>
                      <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                        <div className="text-[10px] text-slate-500">Temp / Humidity</div>
                        <div className="text-sm font-semibold">
                          {formatMetric(markerAirData.weather.temperature)}°C /{' '}
                          {formatMetric(markerAirData.weather.humidity, 0)}%
                        </div>
                      </div>
                    </div>

                    {markerAirData.nearestObservedStation ? (
                      <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-700 dark:text-emerald-300">
                        Nearest physical sensor ({markerAirData.nearestObservedStation.distanceKm} km):{' '}
                        <strong>{markerAirData.nearestObservedStation.name}</strong> · PM2.5{' '}
                        {formatMetric(markerAirData.nearestObservedStation.pm2_5)} µg/m³
                      </div>
                    ) : (
                      <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400">
                        No nearby physical ground sensor within 12 km. Displaying modeled data for these coordinates.
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          ) : selectedStation ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] p-4 space-y-3">
              <div>
                <div className="text-xs text-cyan-600 dark:text-cyan-400 font-medium">
                  {selectedStation.provider} · {selectedStation.sourceType.toUpperCase()}
                </div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {selectedStation.name}
                </h3>
                <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {selectedStation.lat.toFixed(4)}, {selectedStation.lon.toFixed(4)} ·{' '}
                  {formatTimeAgo(selectedStation.observedAt)}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs font-mono tabular-nums">
                <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] text-slate-500">PM2.5 (µg/m³)</div>
                  <div className="text-sm font-semibold">{formatMetric(selectedStation.pm2_5)}</div>
                </div>
                <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] text-slate-500">PM10 (µg/m³)</div>
                  <div className="text-sm font-semibold">{formatMetric(selectedStation.pm10)}</div>
                </div>
                <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] text-slate-500">US AQI</div>
                  <div className="text-sm font-semibold">{selectedStation.us_aqi ?? 'Unavailable'}</div>
                </div>
                <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] text-slate-500">Temp / Humidity</div>
                  <div className="text-sm font-semibold">
                    {formatMetric(selectedStation.temperature)}°C /{' '}
                    {formatMetric(selectedStation.humidity, 0)}%
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  onSelectLocation({
                    name: selectedStation.name,
                    lat: selectedStation.lat,
                    lon: selectedStation.lon,
                  })
                }
                className="w-full py-2 px-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium"
              >
                Focus Dashboard on Station Coordinates
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <MapPin className="w-4 h-4 text-cyan-500" />
                <span>Station &amp; Marker Inspector</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Click any monitoring station, modeled zone, or custom marker on the map to inspect readings, or click <strong>Add Marker</strong> to pin a custom location.
              </p>
            </div>
          )}

          {/* User's Saved Custom Markers List */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1526] p-4 flex-1">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Saved Custom Markers ({markers.length})
              </h3>
              {!user && (
                <button
                  type="button"
                  onClick={onRequireAuth}
                  className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
                >
                  Sign in to save
                </button>
              )}
            </div>

            {markers.length === 0 ? (
              <div className="text-xs text-slate-500 dark:text-slate-400 py-4 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
                {user
                  ? 'No custom markers saved yet. Click "Add Marker" then click anywhere on the map.'
                  : 'Sign in to create and persist custom markers across sessions.'}
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {markers.map((cm) => (
                  <div
                    key={cm.id}
                    className={`p-2.5 rounded-lg border transition-colors ${
                      selectedCustomMarker?.id === cm.id
                        ? 'border-cyan-500 bg-cyan-500/10'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCustomMarker(cm);
                          setSelectedStation(null);
                          setSelectedHotspot(null);
                          setFocusTarget({ lat: cm.lat, lon: cm.lon, zoom: 14, seq: Date.now() });
                          void fetchPollutionForCoordinates(cm.lat, cm.lon, cm.name);
                        }}
                        className="text-left flex-1 min-w-0"
                      >
                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {cm.name}
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {MARKER_TYPE_LABELS[cm.markerType]} · {cm.lat.toFixed(4)}, {cm.lon.toFixed(4)}
                        </div>
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => startEditingCustomMarker(cm)}
                          aria-label={`Edit ${cm.name}`}
                          className="p-1 text-slate-500 hover:text-cyan-500"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCustomMarker(cm.id)}
                          aria-label={`Delete ${cm.name}`}
                          className="p-1 text-slate-500 hover:text-rose-500"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

import type {
  ActiveLocation,
  AirQualityReading,
  AlertRule,
  AqiStandard,
  CustomMarker,
  ForecastResponse,
  GeocodingResult,
  HotspotResponse,
  HourlyPoint,
  MarkerType,
  PollutionAlert,
  SavedLocation,
  StationNode,
} from '../types/env.ts';

async function requestJson<T>(
  url: string,
  options: RequestInit = {},
  token?: string | null
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(url, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error || `Request failed with status ${res.status}`);
  }
  return body as T;
}

export const api = {
  searchLocations: (q: string) =>
    requestJson<{ results: GeocodingResult[]; attribution: string; error?: string }>(
      `/api/locations/search?q=${encodeURIComponent(q)}`
    ),

  reverseGeocode: (lat: number, lon: number) =>
    requestJson<{ name: string; region: string; country: string; displayName: string }>(
      `/api/locations/reverse?lat=${lat}&lon=${lon}`
    ),

  geolocateByIp: () =>
    requestJson<{
      lat: number;
      lon: number;
      name: string;
      region: string;
      country: string;
      source: 'ip_geolocation';
    }>('/api/locations/geolocate'),

  getCurrentAirQuality: (lat: number, lon: number, label?: string, forceRefresh = false) =>
    requestJson<AirQualityReading>(
      `/api/air-quality/current?lat=${lat}&lon=${lon}${label ? `&label=${encodeURIComponent(label)}` : ''}${forceRefresh ? '&refresh=1' : ''}`
    ),

  getHistory: (lat: number, lon: number, days = 7, forceRefresh = false) =>
    requestJson<{
      lat: number;
      lon: number;
      days: number;
      provider: string;
      sourceType: string;
      hourlyPast: HourlyPoint[];
      hourlyForecast: HourlyPoint[];
      errors: string[];
    }>(`/api/air-quality/history?lat=${lat}&lon=${lon}&days=${days}${forceRefresh ? '&refresh=1' : ''}`),

  getStations: (lat: number, lon: number, radiusKm = 25, forceRefresh = false) =>
    requestJson<{
      lat: number;
      lon: number;
      radiusKm: number;
      observedStations: StationNode[];
      modeledGrid: StationNode[];
      iotStations: StationNode[];
      errors: string[];
    }>(`/api/stations?lat=${lat}&lon=${lon}&radiusKm=${radiusKm}${forceRefresh ? '&refresh=1' : ''}`),

  getPredictions: (
    lat: number,
    lon: number,
    target = 'pm2_5',
    horizon = 24,
    retrain = false
  ) =>
    requestJson<ForecastResponse>(
      `/api/predictions?lat=${lat}&lon=${lon}&target=${encodeURIComponent(target)}&horizon=${horizon}${retrain ? '&retrain=1' : ''}`
    ),

  getHotspots: (lat: number, lon: number, pollutant = 'pm2_5', epsKm = 8.5, threshold?: number) =>
    requestJson<HotspotResponse>(
      `/api/hotspots?lat=${lat}&lon=${lon}&pollutant=${encodeURIComponent(pollutant)}&epsKm=${epsKm}${threshold !== undefined ? `&threshold=${threshold}` : ''}`
    ),

  register: (email: string, password: string, displayName: string) =>
    requestJson<{
      token: string;
      user: {
        uid: string;
        email: string;
        displayName: string;
        role: 'user' | 'admin';
        preferredStandard: AqiStandard;
        refreshIntervalSec: number;
        emailAlertsEnabled: boolean;
        theme: 'dark' | 'light';
      };
    }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName }),
    }),

  login: (email: string, password: string) =>
    requestJson<{
      token: string;
      user: {
        uid: string;
        email: string;
        displayName: string;
        role: 'user' | 'admin';
        preferredStandard: AqiStandard;
        refreshIntervalSec: number;
        emailAlertsEnabled: boolean;
        theme: 'dark' | 'light';
      };
    }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  getMarkers: (token: string) =>
    requestJson<{ markers: CustomMarker[] }>('/api/markers', {}, token),

  createMarker: (
    token: string,
    payload: {
      name: string;
      description: string;
      markerType: MarkerType;
      lat: number;
      lon: number;
    }
  ) =>
    requestJson<{ marker: CustomMarker }>(
      '/api/markers',
      { method: 'POST', body: JSON.stringify(payload) },
      token
    ),

  updateMarker: (
    token: string,
    id: string,
    payload: Partial<{
      name: string;
      description: string;
      markerType: MarkerType;
      lat: number;
      lon: number;
    }>
  ) =>
    requestJson<{ marker: CustomMarker }>(
      `/api/markers/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(payload) },
      token
    ),

  deleteMarker: (token: string, id: string) =>
    requestJson<{ deleted: boolean }>(
      `/api/markers/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      token
    ),

  getSavedLocations: (token: string) =>
    requestJson<{ locations: SavedLocation[] }>('/api/saved-locations', {}, token),

  createSavedLocation: (
    token: string,
    payload: {
      name: string;
      country: string;
      region: string;
      lat: number;
      lon: number;
      isPrimary?: boolean;
    }
  ) =>
    requestJson<{ location: SavedLocation }>(
      '/api/saved-locations',
      { method: 'POST', body: JSON.stringify(payload) },
      token
    ),

  setPrimarySavedLocation: (token: string, id: string) =>
    requestJson<{ location: SavedLocation }>(
      `/api/saved-locations/${encodeURIComponent(id)}/primary`,
      { method: 'PATCH' },
      token
    ),

  deleteSavedLocation: (token: string, id: string) =>
    requestJson<{ deleted: boolean }>(
      `/api/saved-locations/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      token
    ),

  getAlerts: (token: string) =>
    requestJson<{ alerts: PollutionAlert[]; rules: AlertRule[] }>('/api/alerts', {}, token),

  createAlertRule: (
    token: string,
    payload: {
      locationName: string;
      lat: number;
      lon: number;
      metric: string;
      threshold: number;
      enabled: boolean;
      emailNotify: boolean;
    }
  ) =>
    requestJson<{ rule: AlertRule }>(
      '/api/alerts/rules',
      { method: 'POST', body: JSON.stringify(payload) },
      token
    ),

  updateAlertRule: (
    token: string,
    id: string,
    payload: Partial<{ enabled: boolean; threshold: number; emailNotify: boolean }>
  ) =>
    requestJson<{ rule: AlertRule }>(
      `/api/alerts/rules/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(payload) },
      token
    ),

  deleteAlertRule: (token: string, id: string) =>
    requestJson<{ deleted: boolean }>(
      `/api/alerts/rules/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      token
    ),

  updateAlertStatus: (
    token: string,
    id: string,
    status: 'active' | 'acknowledged' | 'dismissed'
  ) =>
    requestJson<{ alert: PollutionAlert }>(
      `/api/alerts/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify({ status }) },
      token
    ),

  getIotDevices: () =>
    requestJson<{
      devices: Array<{
        device: {
          deviceId: string;
          ownerId: string;
          name: string;
          lat: number;
          lon: number;
          hardwareModel: string;
          calibrationOffsetPm25: number;
          status: string;
          lastReadingAt: string;
        };
        latest: {
          id: string;
          pm2_5: number | null;
          pm10: number | null;
          temperature: number | null;
          humidity: number | null;
          qualityFlag: string;
          recordedAt: string;
        } | null;
      }>;
    }>('/api/iot/devices'),

  registerIotDevice: (
    token: string,
    payload: {
      name: string;
      deviceId?: string;
      lat: number;
      lon: number;
      hardwareModel: string;
      calibrationOffsetPm25: number;
    }
  ) =>
    requestJson<{ device: unknown }>(
      '/api/iot/devices',
      { method: 'POST', body: JSON.stringify(payload) },
      token
    ),

  ingestIotReading: (
    payload: {
      deviceId: string;
      pm2_5: number;
      pm10?: number;
      temperature?: number;
      humidity?: number;
    },
    token?: string | null
  ) =>
    requestJson<{ reading: unknown }>(
      '/api/iot/readings',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token || undefined
    ),

  ingestV1Csv: (csv: string, token?: string | null) =>
    requestJson<{
      ingestedCount: number;
      errorCount: number;
      readings: unknown[];
      errors: Array<{ index: number; error: string }>;
    }>(
      '/api/v1/ingest',
      {
        method: 'POST',
        body: JSON.stringify({ csv }),
      },
      token || undefined
    ),

  getAdminSettings: () =>
    requestJson<{
      settings: {
        defaultRefreshIntervalSec: number;
        defaultAqiStandard: AqiStandard;
        enableOpenAq: boolean;
        enableSensorCommunity: boolean;
        enableOpenMeteo: boolean;
        defaultCityName: string;
        defaultLat: number;
        defaultLon: number;
      };
      sources: Array<{
        id: string;
        name: string;
        type: string;
        requiresKey: boolean;
        configured: boolean;
        enabled: boolean;
      }>;
    }>('/api/admin/settings'),

  updateAdminSettings: (
    token: string,
    payload: Partial<{
      defaultRefreshIntervalSec: number;
      defaultAqiStandard: AqiStandard;
      enableOpenAq: boolean;
      enableSensorCommunity: boolean;
      enableOpenMeteo: boolean;
      defaultCityName: string;
      defaultLat: number;
      defaultLon: number;
    }>
  ) =>
    requestJson<{ settings: unknown }>(
      '/api/admin/settings',
      { method: 'PATCH', body: JSON.stringify(payload) },
      token
    ),
};

export function createTelemetrySocket(
  activeLocation: ActiveLocation,
  uid: string | undefined,
  intervalSec: number,
  onAirQualityUpdate: (reading: AirQualityReading) => void,
  onAlertTriggered: (alert: PollutionAlert) => void,
  onStatusChange: (connected: boolean) => void
): {
  close: () => void;
  subscribe: (loc: ActiveLocation, uid?: string, nextIntervalSec?: number) => void;
  syncNow: () => void;
  setIntervalSec: (sec: number) => void;
} {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${window.location.host}/ws/air-quality`;

  let ws: WebSocket | null = null;
  let closed = false;
  let currentLoc = activeLocation;
  let currentUid = uid;
  let currentIntervalSec = intervalSec;
  let reconnectTimer: number | null = null;
  let heartbeatTimer: number | null = null;

  const stopHeartbeat = () => {
    if (heartbeatTimer !== null) {
      window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const connect = () => {
    if (closed) return;
    ws = new WebSocket(url);

    ws.onopen = () => {
      onStatusChange(true);
      ws?.send(
        JSON.stringify({
          type: 'subscribe',
          lat: currentLoc.lat,
          lon: currentLoc.lon,
          label: currentLoc.name,
          uid: currentUid,
          intervalSec: currentIntervalSec,
        })
      );
      stopHeartbeat();
      heartbeatTimer = window.setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 25_000);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as { event: string; payload: unknown };
        if (msg.event === 'air_quality:update') {
          onAirQualityUpdate(msg.payload as AirQualityReading);
        } else if (msg.event === 'alert:triggered') {
          onAlertTriggered(msg.payload as PollutionAlert);
        }
      } catch {
        // ignore malformed packets
      }
    };

    ws.onclose = () => {
      stopHeartbeat();
      onStatusChange(false);
      if (!closed) {
        reconnectTimer = window.setTimeout(connect, 5000);
      }
    };

    ws.onerror = () => {
      onStatusChange(false);
    };
  };

  connect();

  return {
    subscribe: (loc: ActiveLocation, nextUid?: string, nextIntervalSec?: number) => {
      currentLoc = loc;
      currentUid = nextUid;
      if (typeof nextIntervalSec === 'number') currentIntervalSec = nextIntervalSec;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'subscribe',
            lat: loc.lat,
            lon: loc.lon,
            label: loc.name,
            uid: nextUid,
            intervalSec: currentIntervalSec,
          })
        );
      }
    },
    syncNow: () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'sync_now' }));
      }
    },
    setIntervalSec: (sec: number) => {
      currentIntervalSec = sec;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'set_interval', intervalSec: sec }));
      }
    },
    close: () => {
      closed = true;
      stopHeartbeat();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}

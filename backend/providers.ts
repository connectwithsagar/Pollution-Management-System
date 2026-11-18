import { apiCache } from './cache.ts';
import { dbStore } from './store.ts';
import type {
  AirQualityReading,
  GeocodingResult,
  HourlyPoint,
  StationNode,
} from './types.ts';

const FETCH_TIMEOUT_MS = 8000;
const HOST_COOLDOWN_MS = 10 * 60_000;
const hostCooldownUntil = new Map<string, number>();

function isHostInCooldown(hostname: string): boolean {
  const until = hostCooldownUntil.get(hostname);
  if (!until) return false;
  if (Date.now() < until) return true;
  hostCooldownUntil.delete(hostname);
  return false;
}

function markHostCooldown(hostname: string): void {
  hostCooldownUntil.set(hostname, Date.now() + HOST_COOLDOWN_MS);
}

function getRetryDelayMs(res: Response | null, attempt: number): number {
  const retryAfter = res?.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(2500, Math.round(seconds * 1000));
    }
  }
  return Math.min(1800, 350 * (attempt + 1) + Math.floor(Math.random() * 150));
}

async function fetchJsonWithTimeout<T>(
  url: string,
  headers: Record<string, string> = {},
  retries = 1,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          ...headers,
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
        const retryable = res.status === 429 || res.status === 408 || res.status >= 500;
        if (retryable && attempt < retries) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, getRetryDelayMs(res, attempt)));
          continue;
        }
        throw err;
      }
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, getRetryDelayMs(null, attempt)));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) * Math.sin(dp / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function computeUsAqiFromPm25(pm25: number | null): number | null {
  if (pm25 === null || pm25 < 0) return null;
  const breakpoints = [
    { cLow: 0, cHigh: 12.0, iLow: 0, iHigh: 50 },
    { cLow: 12.1, cHigh: 35.4, iLow: 51, iHigh: 100 },
    { cLow: 35.5, cHigh: 55.4, iLow: 101, iHigh: 150 },
    { cLow: 55.5, cHigh: 150.4, iLow: 151, iHigh: 200 },
    { cLow: 150.5, cHigh: 250.4, iLow: 201, iHigh: 300 },
    { cLow: 250.5, cHigh: 500.4, iLow: 301, iHigh: 500 },
  ];
  const clamped = Math.min(500.4, pm25);
  const bp =
    breakpoints.find((b) => clamped >= b.cLow && clamped <= b.cHigh) ||
    breakpoints[breakpoints.length - 1];
  return Math.round(((bp.iHigh - bp.iLow) / (bp.cHigh - bp.cLow)) * (clamped - bp.cLow) + bp.iLow);
}

interface OpenMeteoAirQualityResponse {
  current?: {
    time?: string;
    us_aqi?: number;
    european_aqi?: number;
    pm10?: number;
    pm2_5?: number;
    carbon_monoxide?: number;
    nitrogen_dioxide?: number;
    sulphur_dioxide?: number;
    ozone?: number;
  };
  hourly?: {
    time?: string[];
    us_aqi?: Array<number | null>;
    european_aqi?: Array<number | null>;
    pm10?: Array<number | null>;
    pm2_5?: Array<number | null>;
    carbon_monoxide?: Array<number | null>;
    nitrogen_dioxide?: Array<number | null>;
    sulphur_dioxide?: Array<number | null>;
    ozone?: Array<number | null>;
  };
}

interface OpenMeteoWeatherResponse {
  current?: {
    time?: string;
    temperature_2m?: number;
    relative_humidity_2m?: number;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
    surface_pressure?: number;
  };
  hourly?: {
    time?: string[];
    temperature_2m?: Array<number | null>;
    relative_humidity_2m?: Array<number | null>;
    wind_speed_10m?: Array<number | null>;
    wind_direction_10m?: Array<number | null>;
  };
}

interface SensorCommunityEntry {
  sensor?: {
    id?: number;
    sensor_type?: { name?: string; manufacturer?: string };
  };
  location?: {
    id?: number;
    latitude?: string;
    longitude?: string;
    country?: string;
  };
  timestamp?: string;
  sensordatavalues?: Array<{ value_type?: string; value?: string }>;
}

export async function fetchSensorCommunityStations(
  lat: number,
  lon: number,
  radiusKm = 25
): Promise<{ stations: StationNode[]; error?: string }> {
  const settings = dbStore.getAdminSettings();
  if (!settings.enableSensorCommunity) {
    return { stations: [] };
  }

  const key = `sc:${lat.toFixed(2)}:${lon.toFixed(2)}:${Math.round(radiusKm)}`;
  try {
    const { value } = await apiCache.getOrFetch(key, 120_000, async () => {
      const url = `https://data.sensor.community/airrohr/v1/filter/area=${lat.toFixed(4)},${lon.toFixed(4)},${Math.min(50, Math.max(5, radiusKm))}`;
      const rows = await fetchJsonWithTimeout<SensorCommunityEntry[]>(url, {
        'User-Agent': 'AetherGridSmartCity/1.0',
      });

      const byLocation = new Map<string, StationNode>();
      for (const entry of rows) {
        const sLat = numOrNull(entry.location?.latitude);
        const sLon = numOrNull(entry.location?.longitude);
        if (sLat === null || sLon === null) continue;
        const locId = String(entry.location?.id ?? `${sLat.toFixed(4)}_${sLon.toFixed(4)}`);
        const existing = byLocation.get(locId) ?? {
          id: `sc-${locId}`,
          name: `Community Station #${locId}`,
          lat: sLat,
          lon: sLon,
          distanceKm: Number(haversineKm(lat, lon, sLat, sLon).toFixed(2)),
          provider: 'Sensor.Community',
          sourceType: 'observed' as const,
          observedAt: entry.timestamp ? `${entry.timestamp.replace(' ', 'T')}Z` : null,
          pm2_5: null,
          pm10: null,
          no2: null,
          o3: null,
          co: null,
          so2: null,
          us_aqi: null,
          eu_aqi: null,
          temperature: null,
          humidity: null,
          hardwareModel: entry.sensor?.sensor_type?.name || 'SDS011/DHT22',
        };

        for (const v of entry.sensordatavalues ?? []) {
          const val = numOrNull(v.value);
          if (val === null) continue;
          if (v.value_type === 'P2') existing.pm2_5 = Number(val.toFixed(2));
          if (v.value_type === 'P1') existing.pm10 = Number(val.toFixed(2));
          if (v.value_type === 'temperature') existing.temperature = Number(val.toFixed(1));
          if (v.value_type === 'humidity') existing.humidity = Number(val.toFixed(1));
        }

        if (existing.pm2_5 !== null) {
          existing.us_aqi = computeUsAqiFromPm25(existing.pm2_5);
        }
        byLocation.set(locId, existing);
      }

      return Array.from(byLocation.values())
        .filter((s) => s.pm2_5 !== null || s.pm10 !== null || s.temperature !== null)
        .sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999))
        .slice(0, 60);
    });
    return { stations: value };
  } catch (err) {
    return {
      stations: [],
      error: `Sensor.Community unavailable (${err instanceof Error ? err.message : 'fetch error'})`,
    };
  }
}

export async function fetchOpenAqStations(
  lat: number,
  lon: number,
  radiusKm = 25
): Promise<{ stations: StationNode[]; error?: string }> {
  const apiKey = process.env.OPENAQ_API_KEY;
  const settings = dbStore.getAdminSettings();
  if (!settings.enableOpenAq || !apiKey) {
    return {
      stations: [],
      error: apiKey ? undefined : 'OpenAQ API key not configured',
    };
  }

  const key = `openaq:${lat.toFixed(2)}:${lon.toFixed(2)}:${Math.round(radiusKm)}`;
  try {
    const { value } = await apiCache.getOrFetch(key, 180_000, async () => {
      const radiusMeters = Math.min(25000, Math.round(radiusKm * 1000));
      const url = `https://api.openaq.org/v3/locations?coordinates=${lat.toFixed(4)},${lon.toFixed(4)}&radius=${radiusMeters}&limit=25`;
      const data = await fetchJsonWithTimeout<{
        results?: Array<{
          id: number;
          name?: string;
          coordinates?: { latitude?: number; longitude?: number };
          datetimeLast?: { utc?: string };
        }>;
      }>(url, { 'X-API-Key': apiKey });

      const stations: StationNode[] = [];
      for (const loc of data.results ?? []) {
        const sLat = numOrNull(loc.coordinates?.latitude);
        const sLon = numOrNull(loc.coordinates?.longitude);
        if (sLat === null || sLon === null) continue;
        stations.push({
          id: `openaq-${loc.id}`,
          name: loc.name || `OpenAQ Station ${loc.id}`,
          lat: sLat,
          lon: sLon,
          distanceKm: Number(haversineKm(lat, lon, sLat, sLon).toFixed(2)),
          provider: 'OpenAQ v3',
          sourceType: 'observed',
          observedAt: loc.datetimeLast?.utc ?? null,
          pm2_5: null,
          pm10: null,
          no2: null,
          o3: null,
          co: null,
          so2: null,
          us_aqi: null,
          eu_aqi: null,
          temperature: null,
          humidity: null,
        });
      }
      return stations;
    });
    return { stations: value };
  } catch (err) {
    return {
      stations: [],
      error: `OpenAQ unavailable (${err instanceof Error ? err.message : 'fetch error'})`,
    };
  }
}

function normalizeOpenMeteoIso(raw?: string | null): string | null {
  if (!raw) return null;
  if (raw.endsWith('Z')) return raw;
  if (raw.length === 16) return `${raw}:00Z`;
  return `${raw}Z`;
}

type OpenMeteoBundle = {
  current: {
    observedAt: string | null;
    usAqi: number | null;
    euAqi: number | null;
    pm2_5: number | null;
    pm10: number | null;
    co: number | null;
    no2: number | null;
    so2: number | null;
    o3: number | null;
    temperature: number | null;
    humidity: number | null;
    windSpeed: number | null;
    windDirection: number | null;
    surfacePressure: number | null;
  };
  hourlyPast: HourlyPoint[];
  hourlyForecast: HourlyPoint[];
  errors: string[];
};

function buildEmptyOpenMeteoBundle(errors: string[]): OpenMeteoBundle {
  return {
    current: {
      observedAt: null,
      usAqi: null,
      euAqi: null,
      pm2_5: null,
      pm10: null,
      co: null,
      no2: null,
      so2: null,
      o3: null,
      temperature: null,
      humidity: null,
      windSpeed: null,
      windDirection: null,
      surfacePressure: null,
    },
    hourlyPast: [],
    hourlyForecast: [],
    errors,
  };
}

interface MetNoLocationForecastResponse {
  properties?: {
    timeseries?: Array<{
      time?: string;
      data?: {
        instant?: {
          details?: {
            air_temperature?: number;
            relative_humidity?: number;
            wind_speed?: number;
            wind_from_direction?: number;
            air_pressure_at_sea_level?: number;
          };
        };
      };
    }>;
  };
}

async function fetchOpenMeteoWeatherWithFailover(
  lat: number,
  lon: number,
  pastDays: number,
  forecastDays: number
): Promise<OpenMeteoWeatherResponse> {
  const query = `latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,surface_pressure&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m&past_days=${pastDays}&forecast_days=${forecastDays}&timezone=UTC`;
  const primaryHost = 'api.open-meteo.com';
  let lastErr: unknown;

  if (!isHostInCooldown(primaryHost)) {
    try {
      return await fetchJsonWithTimeout<OpenMeteoWeatherResponse>(
        `https://${primaryHost}/v1/forecast?${query}`,
        {},
        0,
        3500
      );
    } catch (err) {
      lastErr = err;
      markHostCooldown(primaryHost);
    }
  }

  try {
    return await fetchJsonWithTimeout<OpenMeteoWeatherResponse>(
      `https://historical-forecast-api.open-meteo.com/v1/forecast?${query}`,
      {},
      1,
      6500
    );
  } catch (err) {
    lastErr = err;
  }

  // Final fallback via Norwegian Meteorological Institute (MET Norway) Locationforecast 2.0
  const metRes = await fetchJsonWithTimeout<MetNoLocationForecastResponse>(
    `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`,
    { 'User-Agent': 'AetherGridSmartCity/1.0 (environmental-dashboard)' },
    0,
    6000
  );

  const series = metRes.properties?.timeseries ?? [];
  if (series.length === 0) {
    throw lastErr instanceof Error ? lastErr : new Error('All weather upstream endpoints failed');
  }

  const firstDetails = series[0]?.data?.instant?.details;
  const times: string[] = [];
  const temps: Array<number | null> = [];
  const hums: Array<number | null> = [];
  const winds: Array<number | null> = [];
  const dirs: Array<number | null> = [];

  for (const row of series) {
    if (!row.time) continue;
    const d = row.data?.instant?.details;
    times.push(row.time.slice(0, 16));
    temps.push(numOrNull(d?.air_temperature));
    hums.push(numOrNull(d?.relative_humidity));
    const ms = numOrNull(d?.wind_speed);
    winds.push(ms !== null ? Number((ms * 3.6).toFixed(1)) : null);
    dirs.push(numOrNull(d?.wind_from_direction));
  }

  const curWindMs = numOrNull(firstDetails?.wind_speed);
  return {
    current: {
      time: series[0]?.time?.slice(0, 16),
      temperature_2m: numOrNull(firstDetails?.air_temperature) ?? undefined,
      relative_humidity_2m: numOrNull(firstDetails?.relative_humidity) ?? undefined,
      wind_speed_10m: curWindMs !== null ? Number((curWindMs * 3.6).toFixed(1)) : undefined,
      wind_direction_10m: numOrNull(firstDetails?.wind_from_direction) ?? undefined,
      surface_pressure: numOrNull(firstDetails?.air_pressure_at_sea_level) ?? undefined,
    },
    hourly: {
      time: times,
      temperature_2m: temps,
      relative_humidity_2m: hums,
      wind_speed_10m: winds,
      wind_direction_10m: dirs,
    },
  };
}

export async function fetchOpenMeteoAirAndWeather(
  lat: number,
  lon: number,
  pastDays = 7,
  forecastDays = 2,
  forceRefresh = false
): Promise<OpenMeteoBundle> {
  const settings = dbStore.getAdminSettings();
  if (!settings.enableOpenMeteo) {
    return buildEmptyOpenMeteoBundle(['Open-Meteo provider is disabled in Admin Settings.']);
  }

  // Reuse an already-cached default 7d/2d bundle when a smaller window is requested
  const defaultWindowKey = `om:${lat.toFixed(3)}:${lon.toFixed(3)}:7:2`;
  const key = `om:${lat.toFixed(3)}:${lon.toFixed(3)}:${pastDays}:${forecastDays}`;
  if (!forceRefresh && pastDays < 7 && forecastDays <= 2) {
    const cachedLarger = apiCache.get<OpenMeteoBundle>(defaultWindowKey);
    if (cachedLarger && !cachedLarger.isStale) {
      return cachedLarger.value;
    }
  }

  try {
    const { value } = await apiCache.getOrFetch<OpenMeteoBundle>(
      key,
      45_000,
      async () => {
        const localErrors: string[] = [];
        const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi,european_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone&hourly=us_aqi,european_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone&past_days=${pastDays}&forecast_days=${forecastDays}&timezone=UTC`;

        const [aqRes, wxRes] = await Promise.allSettled([
          fetchJsonWithTimeout<OpenMeteoAirQualityResponse>(aqUrl, {}, 1, 7000),
          fetchOpenMeteoWeatherWithFailover(lat, lon, pastDays, forecastDays),
        ]);

        const aq = aqRes.status === 'fulfilled' ? aqRes.value : null;
        if (aqRes.status === 'rejected') {
          const msg = aqRes.reason instanceof Error ? aqRes.reason.message : String(aqRes.reason);
          localErrors.push(`Open-Meteo Air Quality failed: ${msg}`);
        }
        const wx = wxRes.status === 'fulfilled' ? wxRes.value : null;
        if (wxRes.status === 'rejected') {
          const msg = wxRes.reason instanceof Error ? wxRes.reason.message : String(wxRes.reason);
          localErrors.push(`Open-Meteo Weather failed: ${msg}`);
        }

        if (!aq && !wx) {
          throw new Error(localErrors.join(' · ') || 'Open-Meteo upstream unreachable');
        }

        const wxByTime = new Map<
          string,
          {
            temperature: number | null;
            humidity: number | null;
            windSpeed: number | null;
            windDirection: number | null;
          }
        >();
        const wxTimes = wx?.hourly?.time ?? [];
        for (let i = 0; i < wxTimes.length; i++) {
          wxByTime.set(wxTimes[i], {
            temperature: numOrNull(wx?.hourly?.temperature_2m?.[i]),
            humidity: numOrNull(wx?.hourly?.relative_humidity_2m?.[i]),
            windSpeed: numOrNull(wx?.hourly?.wind_speed_10m?.[i]),
            windDirection: numOrNull(wx?.hourly?.wind_direction_10m?.[i]),
          });
        }

        const nowMs = Date.now();
        const hourlyPast: HourlyPoint[] = [];
        const hourlyForecast: HourlyPoint[] = [];

        const aqTimes = aq?.hourly?.time ?? [];
        for (let i = 0; i < aqTimes.length; i++) {
          const tRaw = aqTimes[i];
          const tIso = tRaw.endsWith('Z') ? tRaw : `${tRaw}:00Z`;
          const wxRow = wxByTime.get(tRaw);
          const pm25Val = numOrNull(aq?.hourly?.pm2_5?.[i]);
          const pt: HourlyPoint = {
            timestamp: tIso,
            usAqi: numOrNull(aq?.hourly?.us_aqi?.[i]) ?? computeUsAqiFromPm25(pm25Val),
            euAqi: numOrNull(aq?.hourly?.european_aqi?.[i]),
            pm2_5: pm25Val,
            pm10: numOrNull(aq?.hourly?.pm10?.[i]),
            co: numOrNull(aq?.hourly?.carbon_monoxide?.[i]),
            no2: numOrNull(aq?.hourly?.nitrogen_dioxide?.[i]),
            so2: numOrNull(aq?.hourly?.sulphur_dioxide?.[i]),
            o3: numOrNull(aq?.hourly?.ozone?.[i]),
            temperature: wxRow?.temperature ?? null,
            humidity: wxRow?.humidity ?? null,
            windSpeed: wxRow?.windSpeed ?? null,
            windDirection: wxRow?.windDirection ?? null,
            sourceType: 'modeled',
            provider: 'Open-Meteo CAMS',
          };

          const ptMs = Date.parse(tIso);
          if (Number.isFinite(ptMs) && ptMs <= nowMs + 3600_000) {
            hourlyPast.push(pt);
          } else {
            hourlyForecast.push(pt);
          }
        }

        const latestHourlyAq =
          [...hourlyPast]
            .reverse()
            .find((p) => p.pm2_5 !== null || p.usAqi !== null || p.pm10 !== null) ?? null;

        const curPm25 = numOrNull(aq?.current?.pm2_5) ?? latestHourlyAq?.pm2_5 ?? null;
        const curUsAqi =
          numOrNull(aq?.current?.us_aqi) ??
          latestHourlyAq?.usAqi ??
          computeUsAqiFromPm25(curPm25);

        return {
          current: {
            observedAt:
              normalizeOpenMeteoIso(aq?.current?.time) ??
              normalizeOpenMeteoIso(wx?.current?.time) ??
              latestHourlyAq?.timestamp ??
              null,
            usAqi: curUsAqi,
            euAqi: numOrNull(aq?.current?.european_aqi) ?? latestHourlyAq?.euAqi ?? null,
            pm2_5: curPm25,
            pm10: numOrNull(aq?.current?.pm10) ?? latestHourlyAq?.pm10 ?? null,
            co: numOrNull(aq?.current?.carbon_monoxide) ?? latestHourlyAq?.co ?? null,
            no2: numOrNull(aq?.current?.nitrogen_dioxide) ?? latestHourlyAq?.no2 ?? null,
            so2: numOrNull(aq?.current?.sulphur_dioxide) ?? latestHourlyAq?.so2 ?? null,
            o3: numOrNull(aq?.current?.ozone) ?? latestHourlyAq?.o3 ?? null,
            temperature: numOrNull(wx?.current?.temperature_2m) ?? latestHourlyAq?.temperature ?? null,
            humidity:
              numOrNull(wx?.current?.relative_humidity_2m) ?? latestHourlyAq?.humidity ?? null,
            windSpeed: numOrNull(wx?.current?.wind_speed_10m) ?? latestHourlyAq?.windSpeed ?? null,
            windDirection:
              numOrNull(wx?.current?.wind_direction_10m) ?? latestHourlyAq?.windDirection ?? null,
            surfacePressure: numOrNull(wx?.current?.surface_pressure),
          },
          hourlyPast,
          hourlyForecast,
          errors: localErrors,
        };
      },
      forceRefresh,
      (bundle) =>
        bundle.current.usAqi !== null ||
        bundle.current.pm2_5 !== null ||
        bundle.hourlyPast.length > 0
    );

    return value;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return buildEmptyOpenMeteoBundle([msg]);
  }
}

export async function fetchModeledMetroGrid(
  lat: number,
  lon: number,
  forceRefresh = false
): Promise<StationNode[]> {
  if (!dbStore.getAdminSettings().enableOpenMeteo) {
    return [];
  }
  const key = `grid:${lat.toFixed(2)}:${lon.toFixed(2)}`;
  try {
    const { value } = await apiCache.getOrFetch(
      key,
      120_000,
      async () => {
        const offsets = [-0.08, -0.04, 0, 0.04, 0.08];
        const coords: Array<{ lat: number; lon: number; label: string }> = [];
        for (const dLat of offsets) {
          for (const dLon of offsets) {
            coords.push({
              lat: Number((lat + dLat).toFixed(4)),
              lon: Number((lon + dLon).toFixed(4)),
              label: `Grid (${(lat + dLat).toFixed(2)}, ${(lon + dLon).toFixed(2)})`,
            });
          }
        }
        const lats = coords.map((c) => c.lat).join(',');
        const lons = coords.map((c) => c.lon).join(',');
        const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lats}&longitude=${lons}&current=us_aqi,european_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone&timezone=UTC`;
        const data = await fetchJsonWithTimeout<OpenMeteoAirQualityResponse[]>(url);
        if (!Array.isArray(data) || data.length === 0) {
          throw new Error('Open-Meteo grid returned empty response');
        }

        return data.slice(0, coords.length).map((item, idx) => ({
          id: `om-grid-${idx}`,
          name: coords[idx].label,
          lat: coords[idx].lat,
          lon: coords[idx].lon,
          distanceKm: Number(haversineKm(lat, lon, coords[idx].lat, coords[idx].lon).toFixed(2)),
          provider: 'Open-Meteo CAMS Grid',
          sourceType: 'modeled' as const,
          observedAt: normalizeOpenMeteoIso(item.current?.time),
          pm2_5: numOrNull(item.current?.pm2_5),
          pm10: numOrNull(item.current?.pm10),
          no2: numOrNull(item.current?.nitrogen_dioxide),
          o3: numOrNull(item.current?.ozone),
          co: numOrNull(item.current?.carbon_monoxide),
          so2: numOrNull(item.current?.sulphur_dioxide),
          us_aqi:
            numOrNull(item.current?.us_aqi) ??
            computeUsAqiFromPm25(numOrNull(item.current?.pm2_5)),
          eu_aqi: numOrNull(item.current?.european_aqi),
          temperature: null,
          humidity: null,
        }));
      },
      forceRefresh,
      (nodes) => nodes.length > 0
    );
    return value;
  } catch {
    return [];
  }
}

export async function getCurrentAirQuality(
  lat: number,
  lon: number,
  locationLabel?: string,
  forceRefresh = false
): Promise<AirQualityReading> {
  // Use 7-day / 2-day window so /api/air-quality/current, /history, and /predictions coalesce onto one Open-Meteo fetch
  const [omResult, scResult] = await Promise.all([
    fetchOpenMeteoAirAndWeather(lat, lon, 7, 2, forceRefresh),
    fetchSensorCommunityStations(lat, lon, 12),
  ]);

  const errors = [...omResult.errors];
  if (scResult.error) errors.push(scResult.error);

  const iotNodes = dbStore
    .getLatestIotReadings()
    .filter(({ device, latest }) => device.status === 'active' && latest !== null)
    .map(({ device, latest }) => ({
      id: device.deviceId,
      name: device.name,
      lat: device.lat,
      lon: device.lon,
      distanceKm: Number(haversineKm(lat, lon, device.lat, device.lon).toFixed(2)),
      provider: 'ESP32 IoT Network',
      sourceType: 'iot' as const,
      observedAt: latest!.recordedAt,
      pm2_5: latest!.pm2_5,
      pm10: latest!.pm10,
      no2: null,
      o3: null,
      co: null,
      so2: null,
      us_aqi: computeUsAqiFromPm25(latest!.pm2_5),
      eu_aqi: null,
      temperature: latest!.temperature,
      humidity: latest!.humidity,
      hardwareModel: device.hardwareModel,
    }))
    .filter((n) => (n.distanceKm ?? 999) <= 10);

  const nearestObserved = iotNodes[0] ?? scResult.stations[0] ?? null;
  const fetchedAt = new Date().toISOString();
  const observedAt = omResult.current.observedAt;
  const freshnessMinutes = observedAt
    ? Math.max(0, Math.round((Date.now() - Date.parse(observedAt)) / 60000))
    : null;

  return {
    lat,
    lon,
    locationLabel: locationLabel || `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
    provider: 'Open-Meteo CAMS + Forecast',
    sourceType: 'modeled',
    methodology: 'CAMS Global/Regional Atmospheric Model (US EPA & EAQI scales)',
    observedAt,
    fetchedAt,
    freshnessMinutes,
    pollutants: {
      usAqi: omResult.current.usAqi,
      euAqi: omResult.current.euAqi,
      pm2_5: omResult.current.pm2_5,
      pm10: omResult.current.pm10,
      co: omResult.current.co,
      no2: omResult.current.no2,
      so2: omResult.current.so2,
      o3: omResult.current.o3,
    },
    weather: {
      temperature: omResult.current.temperature,
      humidity: omResult.current.humidity,
      windSpeed: omResult.current.windSpeed,
      windDirection: omResult.current.windDirection,
      surfacePressure: omResult.current.surfacePressure,
    },
    nearestObservedStation: nearestObserved,
    providerErrors: errors,
  };
}

export async function getAllStationsForArea(
  lat: number,
  lon: number,
  radiusKm = 25,
  forceRefresh = false
): Promise<{
  observedStations: StationNode[];
  modeledGrid: StationNode[];
  iotStations: StationNode[];
  errors: string[];
}> {
  const [scRes, openAqRes, modeledGrid] = await Promise.all([
    fetchSensorCommunityStations(lat, lon, radiusKm),
    fetchOpenAqStations(lat, lon, radiusKm),
    fetchModeledMetroGrid(lat, lon, forceRefresh),
  ]);

  const errors: string[] = [];
  if (scRes.error) errors.push(scRes.error);
  if (openAqRes.error) errors.push(openAqRes.error);

  const iotStations: StationNode[] = dbStore.getLatestIotReadings().map(({ device, latest }) => ({
    id: device.deviceId,
    name: device.name,
    lat: device.lat,
    lon: device.lon,
    distanceKm: Number(haversineKm(lat, lon, device.lat, device.lon).toFixed(2)),
    provider: 'ESP32 IoT Node',
    sourceType: 'iot',
    observedAt: latest?.recordedAt ?? null,
    pm2_5: latest?.pm2_5 ?? null,
    pm10: latest?.pm10 ?? null,
    no2: null,
    o3: null,
    co: null,
    so2: null,
    us_aqi: computeUsAqiFromPm25(latest?.pm2_5 ?? null),
    eu_aqi: null,
    temperature: latest?.temperature ?? null,
    humidity: latest?.humidity ?? null,
    hardwareModel: device.hardwareModel,
  }));

  return {
    observedStations: [...openAqRes.stations, ...scRes.stations],
    modeledGrid,
    iotStations,
    errors,
  };
}

export async function searchLocations(query: string): Promise<{
  results: GeocodingResult[];
  attribution: string;
  error?: string;
}> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return { results: [], attribution: 'OpenStreetMap Nominatim & Open-Meteo Geocoding' };
  }

  const key = `geo:${trimmed.toLowerCase()}`;
  try {
    const { value } = await apiCache.getOrFetch(key, 600_000, async () => {
      const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(trimmed)}&format=json&addressdetails=1&limit=7`;
      const omUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(trimmed)}&count=5&language=en&format=json`;

      const [nomRes, omRes] = await Promise.allSettled([
        fetchJsonWithTimeout<
          Array<{
            place_id: number;
            display_name: string;
            lat: string;
            lon: string;
            type?: string;
            address?: {
              city?: string;
              town?: string;
              village?: string;
              state?: string;
              country?: string;
              suburb?: string;
            };
          }>
        >(nomUrl, { 'User-Agent': 'AetherGridSmartCity/1.0 (environmental-dashboard)' }),
        fetchJsonWithTimeout<{
          results?: Array<{
            id: number;
            name: string;
            latitude: number;
            longitude: number;
            country?: string;
            admin1?: string;
            feature_code?: string;
          }>;
        }>(omUrl),
      ]);

      const merged: GeocodingResult[] = [];
      const seenCoords = new Set<string>();

      if (nomRes.status === 'fulfilled' && Array.isArray(nomRes.value)) {
        for (const item of nomRes.value) {
          const lat = Number(item.lat);
          const lon = Number(item.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
          const coordKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
          seenCoords.add(coordKey);
          const primaryName =
            item.address?.city ||
            item.address?.town ||
            item.address?.suburb ||
            item.display_name.split(',')[0];
          merged.push({
            id: `nom-${item.place_id}`,
            name: primaryName.trim(),
            displayName: item.display_name,
            country: item.address?.country || '',
            region: item.address?.state || item.address?.suburb || '',
            type: item.type || 'place',
            lat,
            lon,
            provider: 'OpenStreetMap Nominatim',
          });
        }
      }

      if (omRes.status === 'fulfilled' && Array.isArray(omRes.value.results)) {
        for (const item of omRes.value.results) {
          const coordKey = `${item.latitude.toFixed(2)},${item.longitude.toFixed(2)}`;
          if (seenCoords.has(coordKey)) continue;
          merged.push({
            id: `om-${item.id}`,
            name: item.name,
            displayName: [item.name, item.admin1, item.country].filter(Boolean).join(', '),
            country: item.country || '',
            region: item.admin1 || '',
            type: item.feature_code || 'city',
            lat: item.latitude,
            lon: item.longitude,
            provider: 'Open-Meteo Geocoding',
          });
        }
      }

      return merged.slice(0, 10);
    });

    return {
      results: value,
      attribution: '© OpenStreetMap contributors (Nominatim) · Open-Meteo Geocoding',
    };
  } catch (err) {
    return {
      results: [],
      attribution: '© OpenStreetMap contributors',
      error: err instanceof Error ? err.message : 'Geocoding failed',
    };
  }
}

export async function reverseGeocode(
  lat: number,
  lon: number
): Promise<{ name: string; region: string; country: string; displayName: string }> {
  const key = `rev:${lat.toFixed(3)}:${lon.toFixed(3)}`;
  try {
    const { value } = await apiCache.getOrFetch(key, 600_000, async () => {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`;
      const res = await fetchJsonWithTimeout<{
        display_name?: string;
        address?: {
          city?: string;
          town?: string;
          village?: string;
          suburb?: string;
          neighbourhood?: string;
          state?: string;
          country?: string;
        };
      }>(url, { 'User-Agent': 'AetherGridSmartCity/1.0 (environmental-dashboard)' });

      const name =
        res.address?.city ||
        res.address?.town ||
        res.address?.village ||
        res.address?.suburb ||
        res.address?.neighbourhood ||
        `Location (${lat.toFixed(3)}, ${lon.toFixed(3)})`;

      return {
        name,
        region: res.address?.state || res.address?.suburb || '',
        country: res.address?.country || '',
        displayName: res.display_name || name,
      };
    });
    return value;
  } catch {
    return {
      name: `Location (${lat.toFixed(3)}, ${lon.toFixed(3)})`,
      region: '',
      country: '',
      displayName: `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
    };
  }
}

function extractPublicClientIp(rawIp: string | undefined): string | null {
  if (!rawIp) return null;
  const first = rawIp.split(',')[0].trim().replace(/^::ffff:/, '');
  if (
    !first ||
    first === '127.0.0.1' ||
    first === '::1' ||
    first.startsWith('10.') ||
    first.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(first)
  ) {
    return null;
  }
  return first;
}

export async function geolocateByIp(forwardedForHeader?: string, remoteAddr?: string): Promise<{
  lat: number;
  lon: number;
  name: string;
  region: string;
  country: string;
  source: 'ip_geolocation';
}> {
  const clientIp = extractPublicClientIp(forwardedForHeader) || extractPublicClientIp(remoteAddr);
  const url = clientIp
    ? `https://ipwho.is/${encodeURIComponent(clientIp)}`
    : 'https://ipwho.is/';
  const cacheKey = `ipgeo:${clientIp || 'self'}`;

  const { value } = await apiCache.getOrFetch(cacheKey, 300_000, async () => {
    const data = await fetchJsonWithTimeout<{
      success?: boolean;
      latitude?: number;
      longitude?: number;
      city?: string;
      region?: string;
      country?: string;
      message?: string;
    }>(url);

    if (!data.success || typeof data.latitude !== 'number' || typeof data.longitude !== 'number') {
      throw new Error(data.message || 'IP geolocation lookup failed');
    }

    return {
      lat: Number(data.latitude.toFixed(5)),
      lon: Number(data.longitude.toFixed(5)),
      name: data.city || data.region || data.country || 'Approximate Location',
      region: data.region || '',
      country: data.country || '',
      source: 'ip_geolocation' as const,
    };
  });

  return value;
}

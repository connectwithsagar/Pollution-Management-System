export type NavPageId =
  | 'overview'
  | 'map'
  | 'search'
  | 'analytics'
  | 'predictions'
  | 'hotspots'
  | 'alerts'
  | 'saved'
  | 'history'
  | 'settings';

export type AqiStandard = 'US_AQI' | 'EU_AQI';
export type SourceType = 'observed' | 'modeled' | 'ai_forecast' | 'iot';
export type MarkerType = 'home' | 'school' | 'factory' | 'hospital' | 'monitoring_point';
export type AlertMetric = 'us_aqi' | 'eu_aqi' | 'pm2_5' | 'pm10' | 'no2' | 'o3' | 'co' | 'so2';

export interface ActiveLocation {
  name: string;
  country?: string;
  region?: string;
  lat: number;
  lon: number;
}

export interface PollutantSnapshot {
  usAqi: number | null;
  euAqi: number | null;
  pm2_5: number | null;
  pm10: number | null;
  co: number | null;
  no2: number | null;
  so2: number | null;
  o3: number | null;
}

export interface WeatherSnapshot {
  temperature: number | null;
  humidity: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  surfacePressure: number | null;
}

export interface StationNode {
  id: string;
  name: string;
  lat: number;
  lon: number;
  distanceKm?: number;
  provider: string;
  sourceType: SourceType;
  observedAt: string | null;
  pm2_5: number | null;
  pm10: number | null;
  no2: number | null;
  o3: number | null;
  co: number | null;
  so2: number | null;
  us_aqi: number | null;
  eu_aqi: number | null;
  temperature: number | null;
  humidity: number | null;
  hardwareModel?: string;
}

export interface AirQualityReading {
  lat: number;
  lon: number;
  locationLabel: string;
  provider: string;
  sourceType: SourceType;
  methodology: string;
  observedAt: string | null;
  fetchedAt: string;
  freshnessMinutes: number | null;
  pollutants: PollutantSnapshot;
  weather: WeatherSnapshot;
  nearestObservedStation: StationNode | null;
  providerErrors: string[];
}

export interface HourlyPoint {
  timestamp: string;
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
  sourceType: SourceType;
  provider: string;
}

export interface GeocodingResult {
  id: string;
  name: string;
  displayName: string;
  country: string;
  region: string;
  type: string;
  lat: number;
  lon: number;
  provider: string;
}

export interface CustomMarker {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  markerType: MarkerType;
  lat: number;
  lon: number;
  createdAt: string;
  updatedAt: string;
}

export interface SavedLocation {
  id: string;
  ownerId: string;
  name: string;
  country: string;
  region: string;
  lat: number;
  lon: number;
  isPrimary: boolean;
  createdAt: string;
}

export interface AlertRule {
  id: string;
  ownerId: string;
  locationName: string;
  lat: number;
  lon: number;
  metric: AlertMetric;
  threshold: number;
  enabled: boolean;
  emailNotify: boolean;
  lastTriggeredAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PollutionAlert {
  id: string;
  ownerId: string;
  ruleId: string;
  locationName: string;
  metric: string;
  observedValue: number;
  threshold: number;
  sourceType: 'observed' | 'modeled' | 'forecast';
  sourceLabel: string;
  severity: 'moderate' | 'high' | 'critical';
  status: 'active' | 'acknowledged' | 'dismissed';
  dedupeKey: string;
  triggeredAt: string;
}

export interface ForecastStep {
  stepHours: number;
  timestamp: string;
  predictedValue: number;
  lowerBound: number;
  upperBound: number;
  confidencePct: number;
  sourceType: 'ai_forecast';
  sourceLabel: string;
}

export interface ForecastResponse {
  status: 'ready' | 'unavailable';
  reason?: string;
  modelVersion: string;
  algorithm: string;
  target: string;
  horizonHours: number;
  trainedAt: string | null;
  artifactFile?: string;
  splits?: {
    trainSamples: number;
    validationSamples: number;
    testSamples: number;
    splitPolicy: string;
  };
  metrics: {
    validation: { mae: number | null; rmse: number | null; r2: number | null };
    test: { mae: number | null; rmse: number | null; r2: number | null };
    baselinePersistenceTest: { mae: number | null; rmse: number | null; r2: number | null };
  } | null;
  featureImportances?: Array<{ feature: string; importance: number }>;
  horizonSnapshots?: {
    '1h': ForecastStep | null;
    '6h': ForecastStep | null;
    '24h': ForecastStep | null;
  };
  predictions: ForecastStep[];
}

export interface HotspotCluster {
  id: string;
  clusterType: 'dbscan_cluster' | 'threshold_exceedance';
  label: string;
  pollutant: string;
  centroidLat: number;
  centroidLon: number;
  radiusKm: number;
  peakValue: number;
  meanValue: number;
  threshold: number;
  severity: 'moderate' | 'high' | 'critical';
  stationCount: number;
  sourceTypes: string[];
  providers: string[];
  isModeledSurface: boolean;
  observedAt: string;
  supportingStations: Array<{
    id: string;
    name: string;
    value: number;
    sourceType: string;
    lat: number;
    lon: number;
  }>;
}

export interface HotspotResponse {
  status: string;
  algorithm: string;
  pollutant: string;
  threshold: number;
  epsKm: number;
  minSamples: number;
  evaluatedPoints: number;
  elevatedPoints: number;
  hotspots: HotspotCluster[];
  precisionNotice: string;
}

export interface AqiCategoryInfo {
  label: string;
  colorHex: string;
  textClass: string;
  surfaceClass: string;
  advisory: string;
}

export function getAqiCategory(value: number | null, standard: AqiStandard): AqiCategoryInfo {
  if (value === null) {
    return {
      label: 'Unavailable',
      colorHex: '#64748b',
      textClass: 'text-slate-500 dark:text-slate-400',
      surfaceClass: 'border-slate-300 dark:border-slate-700',
      advisory: 'Live index reading is currently unavailable from upstream providers.',
    };
  }

  if (standard === 'EU_AQI') {
    if (value <= 20) {
      return {
        label: 'Good',
        colorHex: '#10b981',
        textClass: 'text-emerald-600 dark:text-emerald-400',
        surfaceClass: 'border-emerald-500/40',
        advisory: 'Air quality is clean with minimal health risk.',
      };
    }
    if (value <= 40) {
      return {
        label: 'Fair',
        colorHex: '#06b6d4',
        textClass: 'text-cyan-600 dark:text-cyan-400',
        surfaceClass: 'border-cyan-500/40',
        advisory: 'Acceptable air quality for general urban activity.',
      };
    }
    if (value <= 60) {
      return {
        label: 'Moderate',
        colorHex: '#f59e0b',
        textClass: 'text-amber-600 dark:text-amber-400',
        surfaceClass: 'border-amber-500/40',
        advisory: 'Sensitive groups should limit prolonged outdoor exertion.',
      };
    }
    if (value <= 80) {
      return {
        label: 'Poor',
        colorHex: '#f97316',
        textClass: 'text-orange-600 dark:text-orange-400',
        surfaceClass: 'border-orange-500/40',
        advisory: 'Reduce outdoor physical activity if respiratory symptoms appear.',
      };
    }
    if (value <= 100) {
      return {
        label: 'Very Poor',
        colorHex: '#ef4444',
        textClass: 'text-rose-600 dark:text-rose-400',
        surfaceClass: 'border-rose-500/40',
        advisory: 'Avoid heavy outdoor exertion; sensitive individuals stay indoors.',
      };
    }
    return {
      label: 'Extremely Poor',
      colorHex: '#dc2626',
      textClass: 'text-red-600 dark:text-red-400',
      surfaceClass: 'border-red-500/50',
      advisory: 'Health alert: keep windows closed and use indoor filtration.',
    };
  }

  // US EPA AQI
  if (value <= 50) {
    return {
      label: 'Good',
      colorHex: '#10b981',
      textClass: 'text-emerald-600 dark:text-emerald-400',
      surfaceClass: 'border-emerald-500/40',
      advisory: 'Clean air; ideal conditions for outdoor activity.',
    };
  }
  if (value <= 100) {
    return {
      label: 'Moderate',
      colorHex: '#06b6d4',
      textClass: 'text-cyan-600 dark:text-cyan-400',
      surfaceClass: 'border-cyan-500/40',
      advisory: 'Acceptable air quality; unusually sensitive individuals take caution.',
    };
  }
  if (value <= 150) {
    return {
      label: 'Unhealthy for Sensitive Groups',
      colorHex: '#f59e0b',
      textClass: 'text-amber-600 dark:text-amber-400',
      surfaceClass: 'border-amber-500/40',
      advisory: 'Sensitive groups should reduce prolonged outdoor exertion.',
    };
  }
  if (value <= 200) {
    return {
      label: 'Unhealthy',
      colorHex: '#f97316',
      textClass: 'text-orange-600 dark:text-orange-400',
      surfaceClass: 'border-orange-500/40',
      advisory: 'Everyone may begin to experience respiratory effects.',
    };
  }
  if (value <= 300) {
    return {
      label: 'Very Unhealthy',
      colorHex: '#ef4444',
      textClass: 'text-rose-600 dark:text-rose-400',
      surfaceClass: 'border-rose-500/40',
      advisory: 'Health warning: avoid prolonged outdoor exposure.',
    };
  }
  return {
    label: 'Hazardous',
    colorHex: '#dc2626',
    textClass: 'text-red-600 dark:text-red-400',
    surfaceClass: 'border-red-500/50',
    advisory: 'Emergency air quality conditions; remain indoors.',
  };
}

export function formatMetric(val: number | null | undefined, decimals = 1): string {
  if (val === null || val === undefined || !Number.isFinite(val)) {
    return 'Unavailable';
  }
  return val.toFixed(decimals);
}

export function formatTimeAgo(iso: string | null | undefined): string {
  if (!iso) return 'Unavailable';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 'Unavailable';
  const diffMin = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const hrs = Math.round(diffMin / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function formatWindCompass(deg: number | null): string {
  if (deg === null || !Number.isFinite(deg)) return 'Unavailable';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return `${dirs[idx]} (${Math.round(deg)}°)`;
}

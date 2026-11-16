export type AqiStandard = 'US_AQI' | 'EU_AQI';
export type SourceType = 'observed' | 'modeled' | 'ai_forecast' | 'iot';
export type MarkerType = 'home' | 'school' | 'factory' | 'hospital' | 'monitoring_point';
export type AlertMetric = 'us_aqi' | 'eu_aqi' | 'pm2_5' | 'pm10' | 'no2' | 'o3' | 'co' | 'so2';

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

export interface IotDevice {
  deviceId: string;
  ownerId: string;
  name: string;
  lat: number;
  lon: number;
  hardwareModel: string;
  calibrationOffsetPm25: number;
  status: 'active' | 'maintenance' | 'offline';
  lastReadingAt: string;
  createdAt: string;
}

export interface IotReading {
  id: string;
  deviceId: string;
  pm2_5: number | null;
  pm10: number | null;
  temperature: number | null;
  humidity: number | null;
  qualityFlag: 'valid' | 'calibrated' | 'suspect';
  calibrationOffsetApplied: number;
  recordedAt: string;
}

export interface LocalUser {
  uid: string;
  email: string;
  displayName: string;
  passwordHash: string;
  role: 'user' | 'admin';
  preferredStandard: AqiStandard;
  refreshIntervalSec: number;
  emailAlertsEnabled: boolean;
  theme: 'dark' | 'light';
  createdAt: string;
  updatedAt: string;
}

export interface AdminSettings {
  defaultRefreshIntervalSec: number;
  defaultAqiStandard: AqiStandard;
  enableOpenAq: boolean;
  enableSensorCommunity: boolean;
  enableOpenMeteo: boolean;
  defaultCityName: string;
  defaultLat: number;
  defaultLon: number;
}

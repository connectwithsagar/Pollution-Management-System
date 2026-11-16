import crypto from 'crypto';
import http from 'http';
import path from 'path';
import dotenv from 'dotenv';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer as createViteServer } from 'vite';
import {
  hashPassword,
  requireAuth,
  signJwt,
  verifyPassword,
  type AuthRequest,
} from './backend/auth.ts';
import { runAiForecast, runHotspotDetection } from './backend/aiBridge.ts';
import { apiCache } from './backend/cache.ts';
import {
  geolocateByIp,
  getAllStationsForArea,
  getCurrentAirQuality,
  fetchOpenMeteoAirAndWeather,
  reverseGeocode,
  searchLocations,
} from './backend/providers.ts';
import { dbStore } from './backend/store.ts';
import {
  attachWebSocketServer,
  broadcastEvent,
  evaluateAlertRulesForCoordinates,
  scheduleWorkerPolling,
} from './backend/worker.ts';
import type { AlertMetric, MarkerType } from './backend/types.ts';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);

// Simple per-IP rate limiter for API routes
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(maxPerMinute = 180) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = req.ip || 'local';
    const now = Date.now();
    const bucket = rateBuckets.get(ip);
    if (!bucket || now > bucket.resetAt) {
      rateBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
      next();
      return;
    }
    bucket.count += 1;
    if (bucket.count > maxPerMinute) {
      res.status(429).json({ error: 'Rate limit exceeded. Please wait before retrying.' });
      return;
    }
    next();
  };
}

function parseCoord(raw: unknown, min: number, max: number): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', rateLimit(240));

  // Health
  app.get('/api/health', (_req, res) => {
    const settings = dbStore.getAdminSettings();
    res.json({
      status: 'ok',
      service: 'AetherGrid Environmental Intelligence API',
      timestamp: new Date().toISOString(),
      cache: apiCache.stats(),
      providers: {
        openMeteo: settings.enableOpenMeteo,
        sensorCommunity: settings.enableSensorCommunity,
        openAqConfigured: Boolean(process.env.OPENAQ_API_KEY),
      },
    });
  });

  // Auth endpoints (Email + Password with scrypt + JWT)
  app.post('/api/auth/register', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const displayName = String(req.body?.displayName || '').trim() || email.split('@')[0];

    if (!email || !email.includes('@') || email.length > 200) {
      res.status(400).json({ error: 'Valid email address is required.' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters.' });
      return;
    }
    if (dbStore.findUserByEmail(email)) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const now = new Date().toISOString();
    const role: 'user' | 'admin' = email === 'whitesangjr07@gmail.com' ? 'admin' : 'user';
    const user = dbStore.upsertUser({
      uid: `loc-${crypto.randomUUID().slice(0, 16)}`,
      email,
      displayName: displayName.slice(0, 120),
      passwordHash: hashPassword(password),
      role,
      preferredStandard: 'US_AQI',
      refreshIntervalSec: 300,
      emailAlertsEnabled: false,
      theme: 'dark',
      createdAt: now,
      updatedAt: now,
    });

    const token = signJwt({
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    });

    res.status(201).json({
      token,
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        preferredStandard: user.preferredStandard,
        refreshIntervalSec: user.refreshIntervalSec,
        emailAlertsEnabled: user.emailAlertsEnabled,
        theme: user.theme,
      },
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const user = dbStore.findUserByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }
    const token = signJwt({
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    });
    res.json({
      token,
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        preferredStandard: user.preferredStandard,
        refreshIntervalSec: user.refreshIntervalSec,
        emailAlertsEnabled: user.emailAlertsEnabled,
        theme: user.theme,
      },
    });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthRequest, res) => {
    res.json({ user: req.authUser });
  });

  // Location Search (Nominatim + Open-Meteo Geocoding)
  app.get('/api/locations/search', async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) {
      res.status(400).json({ error: 'Query parameter q is required.' });
      return;
    }
    const data = await searchLocations(q);
    res.json(data);
  });

  app.get('/api/locations/reverse', async (req, res) => {
    const lat = parseCoord(req.query.lat, -90, 90);
    const lon = parseCoord(req.query.lon, -180, 180);
    if (lat === null || lon === null) {
      res.status(400).json({ error: 'Valid lat and lon are required.' });
      return;
    }
    const data = await reverseGeocode(lat, lon);
    res.json(data);
  });

  app.get('/api/locations/geolocate', async (req, res) => {
    try {
      const forwarded =
        typeof req.headers['x-forwarded-for'] === 'string'
          ? req.headers['x-forwarded-for']
          : undefined;
      const data = await geolocateByIp(forwarded, req.socket.remoteAddress);
      res.json(data);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Unable to determine approximate IP location.',
      });
    }
  });

  // Current Air Quality + Weather
  app.get('/api/air-quality/current', async (req, res) => {
    const settings = dbStore.getAdminSettings();
    const lat = parseCoord(req.query.lat ?? settings.defaultLat, -90, 90);
    const lon = parseCoord(req.query.lon ?? settings.defaultLon, -180, 180);
    const label = typeof req.query.label === 'string' ? req.query.label : undefined;
    if (lat === null || lon === null) {
      res.status(400).json({ error: 'Invalid latitude or longitude.' });
      return;
    }

    try {
      const reading = await getCurrentAirQuality(lat, lon, label);
      const triggered = await evaluateAlertRulesForCoordinates(lat, lon, reading);
      for (const alert of triggered) {
        broadcastEvent('alert:triggered', alert, alert.ownerId);
      }
      res.json(reading);
    } catch (err) {
      res.status(502).json({
        error: 'Unable to retrieve environmental telemetry from upstream providers.',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Historical & Forecast Hourly Series
  app.get('/api/air-quality/history', async (req, res) => {
    const settings = dbStore.getAdminSettings();
    const lat = parseCoord(req.query.lat ?? settings.defaultLat, -90, 90);
    const lon = parseCoord(req.query.lon ?? settings.defaultLon, -180, 180);
    const days = Math.min(14, Math.max(1, Number(req.query.days || 7)));
    if (lat === null || lon === null) {
      res.status(400).json({ error: 'Invalid latitude or longitude.' });
      return;
    }

    try {
      const data = await fetchOpenMeteoAirAndWeather(lat, lon, days, 2);
      res.json({
        lat,
        lon,
        days,
        provider: 'Open-Meteo CAMS + Weather',
        sourceType: 'modeled',
        hourlyPast: data.hourlyPast,
        hourlyForecast: data.hourlyForecast,
        errors: data.errors,
      });
    } catch (err) {
      res.status(502).json({
        error: 'Failed to retrieve historical environmental series.',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Weather endpoint
  app.get('/api/weather', async (req, res) => {
    const settings = dbStore.getAdminSettings();
    const lat = parseCoord(req.query.lat ?? settings.defaultLat, -90, 90);
    const lon = parseCoord(req.query.lon ?? settings.defaultLon, -180, 180);
    if (lat === null || lon === null) {
      res.status(400).json({ error: 'Invalid latitude or longitude.' });
      return;
    }
    try {
      const data = await fetchOpenMeteoAirAndWeather(lat, lon, 2, 2);
      res.json({
        lat,
        lon,
        current: {
          temperature: data.current.temperature,
          humidity: data.current.humidity,
          windSpeed: data.current.windSpeed,
          windDirection: data.current.windDirection,
          surfacePressure: data.current.surfacePressure,
          observedAt: data.current.observedAt,
        },
        hourly: data.hourlyPast.slice(-24),
        errors: data.errors,
      });
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  // Monitoring Stations (Observed Sensor.Community + OpenAQ + Modeled Metro Grid + ESP32 IoT)
  app.get('/api/stations', async (req, res) => {
    const settings = dbStore.getAdminSettings();
    const lat = parseCoord(req.query.lat ?? settings.defaultLat, -90, 90);
    const lon = parseCoord(req.query.lon ?? settings.defaultLon, -180, 180);
    const radiusKm = Math.min(50, Math.max(5, Number(req.query.radiusKm || 25)));
    if (lat === null || lon === null) {
      res.status(400).json({ error: 'Invalid latitude or longitude.' });
      return;
    }
    try {
      const result = await getAllStationsForArea(lat, lon, radiusKm);
      res.json({
        lat,
        lon,
        radiusKm,
        ...result,
      });
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  // AI Forecasting (Python Random Forest Regressor)
  app.get('/api/predictions', async (req, res) => {
    const settings = dbStore.getAdminSettings();
    const lat = parseCoord(req.query.lat ?? settings.defaultLat, -90, 90);
    const lon = parseCoord(req.query.lon ?? settings.defaultLon, -180, 180);
    const target = String(req.query.target || 'pm2_5');
    const horizon = Math.min(48, Math.max(1, Number(req.query.horizon || 24)));
    const forceRetrain = req.query.retrain === '1';

    if (lat === null || lon === null) {
      res.status(400).json({ error: 'Invalid latitude or longitude.' });
      return;
    }

    const allowedTargets = new Set(['pm2_5', 'pm10', 'no2', 'o3', 'usAqi', 'us_aqi']);
    if (!allowedTargets.has(target)) {
      res.status(400).json({ error: 'Unsupported target pollutant for forecasting.' });
      return;
    }
    const normalizedTarget = target === 'us_aqi' ? 'usAqi' : target;

    try {
      const om = await fetchOpenMeteoAirAndWeather(lat, lon, 7, 2);
      const forecast = await runAiForecast({
        locationKey: `${lat.toFixed(2)}_${lon.toFixed(2)}`,
        target: normalizedTarget,
        horizon,
        history: om.hourlyPast,
        weatherForecast: om.hourlyForecast,
        forceRetrain,
      });
      res.json(forecast);
    } catch (err) {
      res.status(500).json({
        status: 'unavailable',
        reason: err instanceof Error ? err.message : 'Forecast engine error',
        predictions: [],
      });
    }
  });

  // Hotspot Detection (Python Haversine DBSCAN)
  app.get('/api/hotspots', async (req, res) => {
    const settings = dbStore.getAdminSettings();
    const lat = parseCoord(req.query.lat ?? settings.defaultLat, -90, 90);
    const lon = parseCoord(req.query.lon ?? settings.defaultLon, -180, 180);
    const pollutant = String(req.query.pollutant || 'pm2_5');
    const epsKm = Math.min(30, Math.max(1, Number(req.query.epsKm || 8.5)));
    const thresholdRaw = req.query.threshold !== undefined ? Number(req.query.threshold) : undefined;

    if (lat === null || lon === null) {
      res.status(400).json({ error: 'Invalid latitude or longitude.' });
      return;
    }

    try {
      const stations = await getAllStationsForArea(lat, lon, 25);
      const combined = [
        ...stations.observedStations,
        ...stations.iotStations,
        ...stations.modeledGrid,
      ];
      const result = await runHotspotDetection({
        pollutant,
        threshold: Number.isFinite(thresholdRaw) ? thresholdRaw : undefined,
        epsKm,
        points: combined,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ status: 'error', reason: String(err), hotspots: [] });
    }
  });

  // Custom Markers (Authenticated, strictly owner-isolated)
  const VALID_MARKER_TYPES = new Set<MarkerType>([
    'home',
    'school',
    'factory',
    'hospital',
    'monitoring_point',
  ]);

  app.get('/api/markers', requireAuth, (req: AuthRequest, res) => {
    const markers = dbStore.getMarkersByOwner(req.authUser!.uid);
    res.json({ markers });
  });

  app.post('/api/markers', requireAuth, (req: AuthRequest, res) => {
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim();
    const markerType = String(req.body?.markerType || 'monitoring_point') as MarkerType;
    const lat = parseCoord(req.body?.lat, -90, 90);
    const lon = parseCoord(req.body?.lon, -180, 180);

    if (!name || name.length > 120) {
      res.status(400).json({ error: 'Marker name (1-120 chars) is required.' });
      return;
    }
    if (!VALID_MARKER_TYPES.has(markerType)) {
      res.status(400).json({ error: 'Invalid markerType.' });
      return;
    }
    if (lat === null || lon === null) {
      res.status(400).json({ error: 'Valid latitude [-90, 90] and longitude [-180, 180] are required.' });
      return;
    }

    const now = new Date().toISOString();
    const marker = dbStore.createMarker({
      id: `mrk-${crypto.randomUUID().slice(0, 12)}`,
      ownerId: req.authUser!.uid,
      name,
      description: description.slice(0, 500),
      markerType,
      lat: Number(lat.toFixed(6)),
      lon: Number(lon.toFixed(6)),
      createdAt: now,
      updatedAt: now,
    });
    res.status(201).json({ marker });
  });

  app.patch('/api/markers/:id', requireAuth, (req: AuthRequest, res) => {
    const existing = dbStore.getMarkerById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Marker not found.' });
      return;
    }
    if (existing.ownerId !== req.authUser!.uid) {
      res.status(403).json({ error: 'Forbidden: you cannot modify another user\'s marker.' });
      return;
    }

    const patch: Record<string, unknown> = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name || name.length > 120) {
        res.status(400).json({ error: 'Invalid marker name.' });
        return;
      }
      patch.name = name;
    }
    if (req.body?.description !== undefined) {
      patch.description = String(req.body.description).trim().slice(0, 500);
    }
    if (req.body?.markerType !== undefined) {
      if (!VALID_MARKER_TYPES.has(req.body.markerType)) {
        res.status(400).json({ error: 'Invalid markerType.' });
        return;
      }
      patch.markerType = req.body.markerType;
    }
    if (req.body?.lat !== undefined) {
      const lat = parseCoord(req.body.lat, -90, 90);
      if (lat === null) {
        res.status(400).json({ error: 'Invalid latitude.' });
        return;
      }
      patch.lat = Number(lat.toFixed(6));
    }
    if (req.body?.lon !== undefined) {
      const lon = parseCoord(req.body.lon, -180, 180);
      if (lon === null) {
        res.status(400).json({ error: 'Invalid longitude.' });
        return;
      }
      patch.lon = Number(lon.toFixed(6));
    }

    const updated = dbStore.updateMarker(req.params.id, req.authUser!.uid, patch);
    res.json({ marker: updated });
  });

  app.delete('/api/markers/:id', requireAuth, (req: AuthRequest, res) => {
    const existing = dbStore.getMarkerById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Marker not found.' });
      return;
    }
    if (existing.ownerId !== req.authUser!.uid) {
      res.status(403).json({ error: 'Forbidden: you cannot delete another user\'s marker.' });
      return;
    }
    dbStore.deleteMarker(req.params.id, req.authUser!.uid);
    res.json({ deleted: true, id: req.params.id });
  });

  // Saved Locations (Authenticated)
  app.get('/api/saved-locations', requireAuth, (req: AuthRequest, res) => {
    res.json({ locations: dbStore.getSavedLocationsByOwner(req.authUser!.uid) });
  });

  app.post('/api/saved-locations', requireAuth, (req: AuthRequest, res) => {
    const name = String(req.body?.name || '').trim();
    const lat = parseCoord(req.body?.lat, -90, 90);
    const lon = parseCoord(req.body?.lon, -180, 180);
    if (!name || lat === null || lon === null) {
      res.status(400).json({ error: 'Valid name, lat, and lon are required.' });
      return;
    }
    const loc = dbStore.createSavedLocation({
      id: `loc-${crypto.randomUUID().slice(0, 12)}`,
      ownerId: req.authUser!.uid,
      name: name.slice(0, 120),
      country: String(req.body?.country || '').slice(0, 100),
      region: String(req.body?.region || '').slice(0, 120),
      lat: Number(lat.toFixed(5)),
      lon: Number(lon.toFixed(5)),
      isPrimary: Boolean(req.body?.isPrimary),
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ location: loc });
  });

  app.patch('/api/saved-locations/:id/primary', requireAuth, (req: AuthRequest, res) => {
    const loc = dbStore.setPrimarySavedLocation(req.params.id, req.authUser!.uid);
    if (!loc) {
      res.status(404).json({ error: 'Saved location not found.' });
      return;
    }
    res.json({ location: loc });
  });

  app.delete('/api/saved-locations/:id', requireAuth, (req: AuthRequest, res) => {
    const deleted = dbStore.deleteSavedLocation(req.params.id, req.authUser!.uid);
    if (!deleted) {
      res.status(404).json({ error: 'Saved location not found.' });
      return;
    }
    res.json({ deleted: true });
  });

  // Alerts & Rules (Authenticated)
  const VALID_METRICS = new Set<AlertMetric>([
    'us_aqi',
    'eu_aqi',
    'pm2_5',
    'pm10',
    'no2',
    'o3',
    'co',
    'so2',
  ]);

  app.get('/api/alerts', requireAuth, (req: AuthRequest, res) => {
    res.json({
      alerts: dbStore.getAlertsByOwner(req.authUser!.uid),
      rules: dbStore.getAlertRulesByOwner(req.authUser!.uid),
    });
  });

  app.get('/api/alerts/rules', requireAuth, (req: AuthRequest, res) => {
    res.json({ rules: dbStore.getAlertRulesByOwner(req.authUser!.uid) });
  });

  app.post('/api/alerts/rules', requireAuth, (req: AuthRequest, res) => {
    const locationName = String(req.body?.locationName || '').trim();
    const lat = parseCoord(req.body?.lat, -90, 90);
    const lon = parseCoord(req.body?.lon, -180, 180);
    const metric = String(req.body?.metric || '') as AlertMetric;
    const threshold = Number(req.body?.threshold);

    if (!locationName || lat === null || lon === null) {
      res.status(400).json({ error: 'Valid locationName, lat, and lon are required.' });
      return;
    }
    if (!VALID_METRICS.has(metric) || !Number.isFinite(threshold) || threshold < 0) {
      res.status(400).json({ error: 'Valid metric and non-negative threshold are required.' });
      return;
    }

    const now = new Date().toISOString();
    const rule = dbStore.createAlertRule({
      id: `rul-${crypto.randomUUID().slice(0, 12)}`,
      ownerId: req.authUser!.uid,
      locationName: locationName.slice(0, 120),
      lat,
      lon,
      metric,
      threshold,
      enabled: req.body?.enabled !== false,
      emailNotify: Boolean(req.body?.emailNotify),
      lastTriggeredAt: '',
      createdAt: now,
      updatedAt: now,
    });
    res.status(201).json({ rule });
  });

  app.patch('/api/alerts/rules/:id', requireAuth, (req: AuthRequest, res) => {
    const updated = dbStore.updateAlertRule(req.params.id, req.authUser!.uid, {
      enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined,
      threshold:
        typeof req.body?.threshold === 'number' && Number.isFinite(req.body.threshold)
          ? req.body.threshold
          : undefined,
      emailNotify:
        typeof req.body?.emailNotify === 'boolean' ? req.body.emailNotify : undefined,
    });
    if (!updated) {
      res.status(404).json({ error: 'Alert rule not found.' });
      return;
    }
    res.json({ rule: updated });
  });

  app.delete('/api/alerts/rules/:id', requireAuth, (req: AuthRequest, res) => {
    const ok = dbStore.deleteAlertRule(req.params.id, req.authUser!.uid);
    if (!ok) {
      res.status(404).json({ error: 'Alert rule not found.' });
      return;
    }
    res.json({ deleted: true });
  });

  app.patch('/api/alerts/:id', requireAuth, (req: AuthRequest, res) => {
    const status = req.body?.status;
    if (status !== 'active' && status !== 'acknowledged' && status !== 'dismissed') {
      res.status(400).json({ error: 'Invalid status.' });
      return;
    }
    const alert = dbStore.updateAlertStatus(req.params.id, req.authUser!.uid, status);
    if (!alert) {
      res.status(404).json({ error: 'Alert not found.' });
      return;
    }
    res.json({ alert });
  });

  // ESP32 & IoT Sensor Ingestion Endpoints
  app.get('/api/iot/devices', (_req, res) => {
    res.json({ devices: dbStore.getLatestIotReadings() });
  });

  app.post('/api/iot/devices', requireAuth, (req: AuthRequest, res) => {
    const name = String(req.body?.name || '').trim();
    const deviceId =
      String(req.body?.deviceId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '') ||
      `esp32-${crypto.randomUUID().slice(0, 8)}`;
    const lat = parseCoord(req.body?.lat, -90, 90);
    const lon = parseCoord(req.body?.lon, -180, 180);
    const hardwareModel = String(req.body?.hardwareModel || 'ESP32 + PMS5003 + BME280').trim();
    const calibrationOffsetPm25 = Number(req.body?.calibrationOffsetPm25 || 0);

    if (!name || lat === null || lon === null) {
      res.status(400).json({ error: 'Valid device name, lat, and lon are required.' });
      return;
    }

    const device = dbStore.registerIotDevice({
      deviceId,
      ownerId: req.authUser!.uid,
      name: name.slice(0, 120),
      lat,
      lon,
      hardwareModel: hardwareModel.slice(0, 120),
      calibrationOffsetPm25: Number.isFinite(calibrationOffsetPm25) ? calibrationOffsetPm25 : 0,
      status: 'active',
      lastReadingAt: '',
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ device });
  });

  app.post('/api/iot/readings', (req, res) => {
    const expectedKey = process.env.IOT_INGEST_KEY;
    if (expectedKey && req.headers['x-iot-key'] !== expectedKey) {
      res.status(401).json({ error: 'Invalid IoT ingestion key.' });
      return;
    }
    const deviceId = String(req.body?.deviceId || '').trim();
    const device = dbStore.getIotDevices().find((d) => d.deviceId === deviceId);
    if (!device) {
      res.status(404).json({ error: `Unknown IoT deviceId: ${deviceId}` });
      return;
    }

    const rawPm25 = req.body?.pm2_5 !== undefined ? Number(req.body.pm2_5) : null;
    const rawPm10 = req.body?.pm10 !== undefined ? Number(req.body.pm10) : null;
    const temp = req.body?.temperature !== undefined ? Number(req.body.temperature) : null;
    const hum = req.body?.humidity !== undefined ? Number(req.body.humidity) : null;

    const calibratedPm25 =
      rawPm25 !== null && Number.isFinite(rawPm25)
        ? Math.max(0, Number((rawPm25 + device.calibrationOffsetPm25).toFixed(2)))
        : null;

    const qualityFlag =
      calibratedPm25 !== null && calibratedPm25 > 1000
        ? 'suspect'
        : device.calibrationOffsetPm25 !== 0
          ? 'calibrated'
          : 'valid';

    const reading = dbStore.addIotReading({
      id: `iot-${crypto.randomUUID().slice(0, 12)}`,
      deviceId: device.deviceId,
      pm2_5: calibratedPm25,
      pm10: rawPm10 !== null && Number.isFinite(rawPm10) ? Number(rawPm10.toFixed(2)) : null,
      temperature: temp !== null && Number.isFinite(temp) ? Number(temp.toFixed(1)) : null,
      humidity: hum !== null && Number.isFinite(hum) ? Number(hum.toFixed(1)) : null,
      qualityFlag,
      calibrationOffsetApplied: device.calibrationOffsetPm25,
      recordedAt: new Date().toISOString(),
    });

    broadcastEvent('iot:reading', { device, reading });
    res.status(201).json({ reading });
  });

  // Admin & Settings
  app.get('/api/admin/settings', (_req, res) => {
    res.json({
      settings: dbStore.getAdminSettings(),
      sources: [
        {
          id: 'open-meteo',
          name: 'Open-Meteo Air Quality & Weather (CAMS)',
          type: 'Modeled Forecast & Reanalysis',
          requiresKey: false,
          configured: true,
          enabled: dbStore.getAdminSettings().enableOpenMeteo,
        },
        {
          id: 'sensor-community',
          name: 'Sensor.Community Global Network',
          type: 'Observed Physical Ground Sensors',
          requiresKey: false,
          configured: true,
          enabled: dbStore.getAdminSettings().enableSensorCommunity,
        },
        {
          id: 'openaq',
          name: 'OpenAQ v3 Reference Network',
          type: 'Official & Reference Ground Stations',
          requiresKey: true,
          configured: Boolean(process.env.OPENAQ_API_KEY),
          enabled: dbStore.getAdminSettings().enableOpenAq,
        },
        {
          id: 'nominatim',
          name: 'OpenStreetMap Nominatim + Open-Meteo Geocoding',
          type: 'Geocoding & Landmark Search',
          requiresKey: false,
          configured: true,
          enabled: true,
        },
      ],
    });
  });

  app.patch('/api/admin/settings', requireAuth, (req: AuthRequest, res) => {
    if (req.authUser!.role !== 'admin') {
      res.status(403).json({ error: 'Administrator role required to modify global settings.' });
      return;
    }
    const patch: Record<string, unknown> = {};
    if (typeof req.body?.defaultRefreshIntervalSec === 'number') {
      patch.defaultRefreshIntervalSec = Math.min(3600, Math.max(60, req.body.defaultRefreshIntervalSec));
    }
    if (req.body?.defaultAqiStandard === 'US_AQI' || req.body?.defaultAqiStandard === 'EU_AQI') {
      patch.defaultAqiStandard = req.body.defaultAqiStandard;
    }
    if (typeof req.body?.enableSensorCommunity === 'boolean') {
      patch.enableSensorCommunity = req.body.enableSensorCommunity;
    }
    if (typeof req.body?.enableOpenMeteo === 'boolean') {
      patch.enableOpenMeteo = req.body.enableOpenMeteo;
    }
    if (typeof req.body?.enableOpenAq === 'boolean') {
      patch.enableOpenAq = req.body.enableOpenAq;
    }
    if (typeof req.body?.defaultCityName === 'string' && req.body.defaultCityName.trim()) {
      patch.defaultCityName = req.body.defaultCityName.trim().slice(0, 120);
    }
    if (typeof req.body?.defaultLat === 'number' && typeof req.body?.defaultLon === 'number') {
      patch.defaultLat = req.body.defaultLat;
      patch.defaultLon = req.body.defaultLon;
    }

    const updated = dbStore.updateAdminSettings(patch);
    scheduleWorkerPolling();
    res.json({ settings: updated });
  });

  return app;
}

async function startServer() {
  const app = createApp();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws/air-quality' });
  attachWebSocketServer(wss);

  const isProd = process.env.NODE_ENV === 'production';
  if (isProd) {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`AetherGrid Smart City Server listening on http://0.0.0.0:${PORT}`);
  });
}

if (process.env.VITEST !== 'true') {
  void startServer();
}

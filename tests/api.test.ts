import { spawnSync } from 'child_process';
import http from 'http';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server.ts';
import { computeUsAqiFromPm25, haversineKm } from '../backend/providers.ts';

let server: http.Server;
let baseUrl = '';

async function req(
  route: string,
  options: RequestInit = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

beforeAll(async () => {
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('AetherGrid Backend & Security Tests', () => {
  it('returns healthy status from /api/health', async () => {
    const res = await req('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('computes US EPA AQI breakpoints and Haversine distances accurately', () => {
    expect(computeUsAqiFromPm25(0)).toBe(0);
    expect(computeUsAqiFromPm25(12.0)).toBe(50);
    expect(computeUsAqiFromPm25(35.4)).toBe(100);
    expect(computeUsAqiFromPm25(null)).toBeNull();
    const dist = haversineKm(37.7749, -122.4194, 37.8044, -122.2712);
    expect(dist).toBeGreaterThan(10);
    expect(dist).toBeLessThan(20);
  });

  it('enforces authentication, marker persistence, input validation, and cross-user authorization', async () => {
    // Unauthenticated marker access must fail
    const unauth = await req('/api/markers');
    expect(unauth.status).toBe(401);

    const unique = Date.now();
    const regA = await req('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: `alice_${unique}@example.com`,
        password: 'Password123!',
        displayName: 'Alice',
      }),
    });
    expect(regA.status).toBe(201);
    const tokenA = String(regA.body.token);

    const regB = await req('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: `bob_${unique}@example.com`,
        password: 'Password123!',
        displayName: 'Bob',
      }),
    });
    expect(regB.status).toBe(201);
    const tokenB = String(regB.body.token);

    // Invalid coordinates rejected
    const badCoord = await req('/api/markers', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        name: 'Invalid Point',
        description: '',
        markerType: 'home',
        lat: 120,
        lon: -122,
      }),
    });
    expect(badCoord.status).toBe(400);

    // User A creates a marker
    const created = await req('/api/markers', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        name: 'Alice School Marker',
        description: 'Near playground',
        markerType: 'school',
        lat: 37.775,
        lon: -122.418,
      }),
    });
    expect(created.status).toBe(201);
    const marker = created.body.marker as { id: string; name: string };
    expect(marker.name).toBe('Alice School Marker');

    // User B cannot update or delete User A's marker
    const crossPatch = await req(`/api/markers/${marker.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ name: 'Hijacked' }),
    });
    expect(crossPatch.status).toBe(403);

    const crossDel = await req(`/api/markers/${marker.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect(crossDel.status).toBe(403);

    // User A updates & persists marker
    const updated = await req(`/api/markers/${marker.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ lat: 37.781, name: 'Alice School Updated' }),
    });
    expect(updated.status).toBe(200);
    expect((updated.body.marker as { name: string }).name).toBe('Alice School Updated');

    // Login again and verify persistence
    const loginA = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: `alice_${unique}@example.com`,
        password: 'Password123!',
      }),
    });
    expect(loginA.status).toBe(200);
    const listA = await req('/api/markers', {
      headers: { Authorization: `Bearer ${String(loginA.body.token)}` },
    });
    expect(listA.status).toBe(200);
    const list = listA.body.markers as Array<{ id: string; lat: number }>;
    expect(list.some((m) => m.id === marker.id && m.lat === 37.781)).toBe(true);

    // Clean up marker
    const delA = await req(`/api/markers/${marker.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(delA.status).toBe(200);
  });

  it('ingests ESP32 IoT readings with calibration offset', async () => {
    const res = await req('/api/iot/readings', {
      method: 'POST',
      body: JSON.stringify({
        deviceId: 'esp32-node-alpha-01',
        pm2_5: 22.0,
        pm10: 35.0,
        temperature: 20.5,
        humidity: 55,
      }),
    });
    expect(res.status).toBe(201);
    const reading = res.body.reading as { pm2_5: number; qualityFlag: string };
    expect(reading.pm2_5).toBe(21.6); // 22.0 + (-0.4 calibration offset)
    expect(reading.qualityFlag).toBe('calibrated');
  });

  it('validates reverse geocoding coordinates and resolves IP geolocation fallback', async () => {
    const badReverse = await req('/api/locations/reverse?lat=999&lon=0');
    expect(badReverse.status).toBe(400);

    const revRes = await req('/api/locations/reverse?lat=37.7749&lon=-122.4194');
    expect(revRes.status).toBe(200);
    expect(typeof revRes.body.name).toBe('string');
    expect(typeof revRes.body.displayName).toBe('string');
    expect(typeof revRes.body.country).toBe('string');

    const geoRes = await req('/api/locations/geolocate');
    expect([200, 502]).toContain(geoRes.status);
    if (geoRes.status === 200) {
      expect(typeof geoRes.body.lat).toBe('number');
      expect(typeof geoRes.body.lon).toBe('number');
      expect(geoRes.body.source).toBe('ip_geolocation');
    }
  });
});

describe('Python AI Forecast & DBSCAN Hotspot Engines', () => {
  it('trains Random Forest chronologically with evaluation metrics and returns unavailable on insufficient history', () => {
    const script = path.resolve(process.cwd(), 'ai/forecast_engine.py');

    // 1. Insufficient history -> graceful unavailable
    const shortRun = spawnSync('python3', [script], {
      input: JSON.stringify({ target: 'pm2_5', horizon: 24, history: [] }),
      encoding: 'utf-8',
    });
    expect(shortRun.status).toBe(0);
    const shortOut = JSON.parse(shortRun.stdout);
    expect(shortOut.status).toBe('unavailable');

    // 2. Sufficient 96h synthetic-free deterministic series -> chronological split & MAE/RMSE
    const history = Array.from({ length: 96 }, (_, i) => {
      const dt = new Date(Date.UTC(2026, 10, 10, i, 0, 0)).toISOString();
      return {
        timestamp: dt,
        pm2_5: Number((14 + 5 * Math.sin(i / 4) + (i % 6) * 0.4).toFixed(2)),
        temperature: 18 + 3 * Math.cos(i / 6),
        humidity: 55 + 10 * Math.sin(i / 8),
        windSpeed: 8 + (i % 5),
        windDirection: (i * 15) % 360,
      };
    });

    const fullRun = spawnSync('python3', [script], {
      input: JSON.stringify({
        locationKey: 'vitest_sf',
        target: 'pm2_5',
        horizon: 24,
        history,
        weatherForecast: [],
      }),
      encoding: 'utf-8',
    });
    expect(fullRun.status).toBe(0);
    const out = JSON.parse(fullRun.stdout);
    expect(out.status).toBe('ready');
    expect(out.predictions.length).toBe(24);
    expect(out.splits.splitPolicy).toBe('chronological_70_15_15_no_future_leakage');
    expect(typeof out.metrics.test.mae).toBe('number');
    expect(typeof out.metrics.test.rmse).toBe('number');
  });

  it('clusters elevated stations via Haversine DBSCAN', () => {
    const script = path.resolve(process.cwd(), 'ai/hotspot_dbscan.py');
    const points = [
      { id: 's1', name: 'A1', lat: 37.77, lon: -122.42, pm2_5: 42.0, sourceType: 'observed', provider: 'SC' },
      { id: 's2', name: 'A2', lat: 37.78, lon: -122.41, pm2_5: 38.5, sourceType: 'observed', provider: 'SC' },
      { id: 's3', name: 'Clean', lat: 37.90, lon: -122.30, pm2_5: 9.0, sourceType: 'modeled', provider: 'OM' },
    ];
    const run = spawnSync('python3', [script], {
      input: JSON.stringify({ pollutant: 'pm2_5', threshold: 25, epsKm: 8.5, points }),
      encoding: 'utf-8',
    });
    expect(run.status).toBe(0);
    const out = JSON.parse(run.stdout);
    expect(out.hotspots.length).toBe(1);
    expect(out.hotspots[0].stationCount).toBe(2);
    expect(out.hotspots[0].clusterType).toBe('dbscan_cluster');
  });
});

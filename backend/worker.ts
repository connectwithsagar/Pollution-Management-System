import crypto from 'crypto';
import type { WebSocket, WebSocketServer } from 'ws';
import { getCurrentAirQuality } from './providers.ts';
import { dbStore } from './store.ts';
import type { AlertMetric, AirQualityReading, PollutionAlert } from './types.ts';

interface ClientMeta {
  ws: WebSocket;
  lat: number;
  lon: number;
  label: string;
  uid?: string;
}

const clients = new Map<WebSocket, ClientMeta>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

function extractMetricValue(reading: AirQualityReading, metric: AlertMetric): number | null {
  const p = reading.pollutants;
  switch (metric) {
    case 'us_aqi':
      return p.usAqi;
    case 'eu_aqi':
      return p.euAqi;
    case 'pm2_5':
      return p.pm2_5;
    case 'pm10':
      return p.pm10;
    case 'no2':
      return p.no2;
    case 'o3':
      return p.o3;
    case 'co':
      return p.co;
    case 'so2':
      return p.so2;
    default:
      return null;
  }
}

export async function evaluateAlertRulesForCoordinates(
  lat: number,
  lon: number,
  reading: AirQualityReading
): Promise<PollutionAlert[]> {
  const rules = dbStore.getAllEnabledAlertRules();
  const created: PollutionAlert[] = [];

  for (const rule of rules) {
    const closeEnough =
      Math.abs(rule.lat - lat) <= 0.35 && Math.abs(rule.lon - lon) <= 0.35;
    if (!closeEnough) continue;

    // Prefer verified ground/IoT PM2.5 when evaluating PM2.5 close to station, otherwise labeled modeled reading
    let value = extractMetricValue(reading, rule.metric);
    let sourceType: 'observed' | 'modeled' = 'modeled';
    let sourceLabel = reading.provider;

    if (
      rule.metric === 'pm2_5' &&
      reading.nearestObservedStation &&
      (reading.nearestObservedStation.distanceKm ?? 999) <= 5 &&
      reading.nearestObservedStation.pm2_5 !== null
    ) {
      value = reading.nearestObservedStation.pm2_5;
      sourceType = 'observed';
      sourceLabel = `${reading.nearestObservedStation.provider} (${reading.nearestObservedStation.name})`;
    }

    if (value === null || value < rule.threshold) continue;

    const hourBucket = new Date().toISOString().slice(0, 13);
    const dedupeKey = `${rule.id}:${rule.metric}:${hourBucket}`;
    if (dbStore.hasRecentAlertWithDedupe(dedupeKey, 30 * 60 * 1000)) {
      continue;
    }

    const ratio = value / Math.max(1, rule.threshold);
    const severity: PollutionAlert['severity'] =
      ratio >= 1.75 ? 'critical' : ratio >= 1.25 ? 'high' : 'moderate';

    const alert = dbStore.createAlert({
      id: `alt-${crypto.randomUUID().slice(0, 12)}`,
      ownerId: rule.ownerId,
      ruleId: rule.id,
      locationName: rule.locationName,
      metric: rule.metric,
      observedValue: Number(value.toFixed(2)),
      threshold: rule.threshold,
      sourceType,
      sourceLabel,
      severity,
      status: 'active',
      dedupeKey,
      triggeredAt: new Date().toISOString(),
    });

    dbStore.updateAlertRule(rule.id, rule.ownerId, {
      lastTriggeredAt: alert.triggeredAt,
    });
    created.push(alert);
  }

  return created;
}

export function broadcastEvent(event: string, payload: unknown, targetUid?: string): void {
  const msg = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
  for (const [ws, meta] of clients.entries()) {
    if (ws.readyState !== ws.OPEN) continue;
    if (targetUid && meta.uid !== targetUid) continue;
    ws.send(msg);
  }
}

export async function runLiveRefreshCycle(): Promise<void> {
  const settings = dbStore.getAdminSettings();
  const targets = new Map<string, { lat: number; lon: number; label: string }>();

  targets.set(`${settings.defaultLat.toFixed(2)},${settings.defaultLon.toFixed(2)}`, {
    lat: settings.defaultLat,
    lon: settings.defaultLon,
    label: settings.defaultCityName,
  });

  for (const meta of clients.values()) {
    const key = `${meta.lat.toFixed(2)},${meta.lon.toFixed(2)}`;
    if (!targets.has(key)) {
      targets.set(key, { lat: meta.lat, lon: meta.lon, label: meta.label });
    }
  }

  for (const target of targets.values()) {
    try {
      const reading = await getCurrentAirQuality(target.lat, target.lon, target.label);
      const triggeredAlerts = await evaluateAlertRulesForCoordinates(
        target.lat,
        target.lon,
        reading
      );

      for (const [ws, meta] of clients.entries()) {
        if (ws.readyState !== ws.OPEN) continue;
        if (
          Math.abs(meta.lat - target.lat) <= 0.1 &&
          Math.abs(meta.lon - target.lon) <= 0.1
        ) {
          ws.send(
            JSON.stringify({
              event: 'air_quality:update',
              payload: reading,
              timestamp: new Date().toISOString(),
            })
          );
        }
      }

      for (const alert of triggeredAlerts) {
        broadcastEvent('alert:triggered', alert, alert.ownerId);
      }
    } catch (err) {
      console.error('Background refresh error:', err);
    }
  }
}

export function attachWebSocketServer(wss: WebSocketServer): void {
  wss.on('connection', (ws) => {
    const settings = dbStore.getAdminSettings();
    clients.set(ws, {
      ws,
      lat: settings.defaultLat,
      lon: settings.defaultLon,
      label: settings.defaultCityName,
    });

    ws.send(
      JSON.stringify({
        event: 'connection:ready',
        payload: {
          refreshIntervalSec: settings.defaultRefreshIntervalSec,
        },
        timestamp: new Date().toISOString(),
      })
    );

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          lat?: number;
          lon?: number;
          label?: string;
          uid?: string;
        };
        const meta = clients.get(ws);
        if (!meta) return;

        if (msg.type === 'subscribe') {
          if (typeof msg.lat === 'number' && Number.isFinite(msg.lat)) meta.lat = msg.lat;
          if (typeof msg.lon === 'number' && Number.isFinite(msg.lon)) meta.lon = msg.lon;
          if (typeof msg.label === 'string' && msg.label.trim()) meta.label = msg.label.trim();
          if (typeof msg.uid === 'string') meta.uid = msg.uid;

          const reading = await getCurrentAirQuality(meta.lat, meta.lon, meta.label);
          ws.send(
            JSON.stringify({
              event: 'air_quality:update',
              payload: reading,
              timestamp: new Date().toISOString(),
            })
          );
        } else if (msg.type === 'ping') {
          ws.send(JSON.stringify({ event: 'pong', timestamp: new Date().toISOString() }));
        }
      } catch {
        // ignore malformed client messages
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
    });
  });

  scheduleWorkerPolling();
}

export function scheduleWorkerPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  const settings = dbStore.getAdminSettings();
  const intervalMs = Math.max(60_000, settings.defaultRefreshIntervalSec * 1000);
  pollTimer = setInterval(() => {
    void runLiveRefreshCycle();
  }, intervalMs);
}

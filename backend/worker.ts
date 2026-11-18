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
  syncIntervalSec: number;
  lastSyncedAt: number;
}

const clients = new Map<WebSocket, ClientMeta>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let syncRunning = false;

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

async function syncTargetAndPush(
  target: { lat: number; lon: number; label: string },
  dueClients: ClientMeta[],
  forceRefresh: boolean
): Promise<void> {
  const reading = await getCurrentAirQuality(target.lat, target.lon, target.label, forceRefresh);
  const triggeredAlerts = await evaluateAlertRulesForCoordinates(
    target.lat,
    target.lon,
    reading
  );
  const now = Date.now();
  const payload = JSON.stringify({
    event: 'air_quality:update',
    payload: reading,
    timestamp: new Date(now).toISOString(),
  });

  for (const meta of dueClients) {
    if (meta.ws.readyState !== meta.ws.OPEN) continue;
    meta.lastSyncedAt = now;
    meta.ws.send(payload);
  }

  for (const alert of triggeredAlerts) {
    broadcastEvent('alert:triggered', alert, alert.ownerId);
  }
}

export async function runLiveRefreshCycle(forceRefresh = true): Promise<void> {
  if (syncRunning) return;
  syncRunning = true;
  try {
    const settings = dbStore.getAdminSettings();
    const now = Date.now();
    const targets = new Map<
      string,
      { lat: number; lon: number; label: string; dueClients: ClientMeta[] }
    >();

    for (const meta of clients.values()) {
      if (meta.ws.readyState !== meta.ws.OPEN) continue;
      if (now - meta.lastSyncedAt < meta.syncIntervalSec * 1000) continue;

      const key = `${meta.lat.toFixed(2)},${meta.lon.toFixed(2)}`;
      const existing = targets.get(key);
      if (existing) {
        existing.dueClients.push(meta);
      } else {
        targets.set(key, {
          lat: meta.lat,
          lon: meta.lon,
          label: meta.label,
          dueClients: [meta],
        });
      }
    }

    // Ensure background alert evaluation continues for default city when no clients are subscribed to it
    const defKey = `${settings.defaultLat.toFixed(2)},${settings.defaultLon.toFixed(2)}`;
    if (!targets.has(defKey) && clients.size === 0) {
      targets.set(defKey, {
        lat: settings.defaultLat,
        lon: settings.defaultLon,
        label: settings.defaultCityName,
        dueClients: [],
      });
    }

    for (const target of targets.values()) {
      try {
        await syncTargetAndPush(target, target.dueClients, forceRefresh);
      } catch (err) {
        console.error('Background refresh error:', err);
      }
    }
  } finally {
    syncRunning = false;
  }
}

export function attachWebSocketServer(wss: WebSocketServer): void {
  wss.on('connection', (ws) => {
    const settings = dbStore.getAdminSettings();
    const initialInterval = Math.min(
      3600,
      Math.max(15, settings.defaultRefreshIntervalSec || 60)
    );
    clients.set(ws, {
      ws,
      lat: settings.defaultLat,
      lon: settings.defaultLon,
      label: settings.defaultCityName,
      syncIntervalSec: initialInterval,
      lastSyncedAt: 0,
    });

    ws.send(
      JSON.stringify({
        event: 'connection:ready',
        payload: {
          refreshIntervalSec: initialInterval,
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
          intervalSec?: number;
          force?: boolean;
        };
        const meta = clients.get(ws);
        if (!meta) return;

        if (msg.type === 'subscribe') {
          if (typeof msg.lat === 'number' && Number.isFinite(msg.lat)) meta.lat = msg.lat;
          if (typeof msg.lon === 'number' && Number.isFinite(msg.lon)) meta.lon = msg.lon;
          if (typeof msg.label === 'string' && msg.label.trim()) meta.label = msg.label.trim();
          if (typeof msg.uid === 'string') meta.uid = msg.uid;
          if (typeof msg.intervalSec === 'number' && Number.isFinite(msg.intervalSec)) {
            meta.syncIntervalSec = Math.min(3600, Math.max(15, Math.round(msg.intervalSec)));
          }

          await syncTargetAndPush(
            { lat: meta.lat, lon: meta.lon, label: meta.label },
            [meta],
            msg.force === true
          );
        } else if (msg.type === 'sync_now') {
          await syncTargetAndPush(
            { lat: meta.lat, lon: meta.lon, label: meta.label },
            [meta],
            true
          );
        } else if (msg.type === 'set_interval') {
          if (typeof msg.intervalSec === 'number' && Number.isFinite(msg.intervalSec)) {
            meta.syncIntervalSec = Math.min(3600, Math.max(15, Math.round(msg.intervalSec)));
            ws.send(
              JSON.stringify({
                event: 'sync:config',
                payload: { syncIntervalSec: meta.syncIntervalSec },
                timestamp: new Date().toISOString(),
              })
            );
          }
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
  // Check due client syncs every 5 seconds so fast 15s/30s/60s sync intervals trigger accurately
  pollTimer = setInterval(() => {
    void runLiveRefreshCycle(false);
  }, 5_000);
}

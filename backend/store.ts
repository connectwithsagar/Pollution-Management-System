import fs from 'fs';
import path from 'path';
import type {
  AdminSettings,
  AlertRule,
  CustomMarker,
  IotDevice,
  IotReading,
  LocalUser,
  PollutionAlert,
  SavedLocation,
} from './types.ts';

interface StoreData {
  users: LocalUser[];
  markers: CustomMarker[];
  savedLocations: SavedLocation[];
  alertRules: AlertRule[];
  alerts: PollutionAlert[];
  iotDevices: IotDevice[];
  iotReadings: IotReading[];
  adminSettings: AdminSettings;
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const STORE_PATH = path.join(DATA_DIR, 'aethergrid-store.json');

const DEFAULT_DATA: StoreData = {
  users: [],
  markers: [],
  savedLocations: [],
  alertRules: [],
  alerts: [],
  iotDevices: [
    {
      deviceId: 'esp32-node-alpha-01',
      ownerId: 'system',
      name: 'Civic Center ESP32 Node 01',
      lat: 37.7793,
      lon: -122.4193,
      hardwareModel: 'ESP32-S3 + Sensirion SPS30 + BME280',
      calibrationOffsetPm25: -0.4,
      status: 'active',
      lastReadingAt: '',
      createdAt: new Date().toISOString(),
    },
  ],
  iotReadings: [],
  adminSettings: {
    defaultRefreshIntervalSec: 300,
    defaultAqiStandard: 'US_AQI',
    enableOpenAq: Boolean(process.env.OPENAQ_API_KEY),
    enableSensorCommunity: true,
    enableOpenMeteo: true,
    defaultCityName: 'San Francisco',
    defaultLat: 37.7749,
    defaultLon: -122.4194,
  },
};

function loadStore(): StoreData {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(STORE_PATH)) {
      fs.writeFileSync(STORE_PATH, JSON.stringify(DEFAULT_DATA, null, 2), 'utf-8');
      return structuredClone(DEFAULT_DATA);
    }
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<StoreData>;
    return {
      users: parsed.users ?? [],
      markers: parsed.markers ?? [],
      savedLocations: parsed.savedLocations ?? [],
      alertRules: parsed.alertRules ?? [],
      alerts: parsed.alerts ?? [],
      iotDevices: parsed.iotDevices ?? structuredClone(DEFAULT_DATA.iotDevices),
      iotReadings: parsed.iotReadings ?? [],
      adminSettings: { ...DEFAULT_DATA.adminSettings, ...(parsed.adminSettings ?? {}) },
    };
  } catch (err) {
    console.error('Failed to load store, initializing fresh store:', err);
    return structuredClone(DEFAULT_DATA);
  }
}

class PersistentStore {
  private data: StoreData;

  constructor() {
    this.data = loadStore();
  }

  private persist(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const tmpPath = `${STORE_PATH}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tmpPath, STORE_PATH);
    } catch (err) {
      console.error('Failed to persist store:', err);
    }
  }

  getUsers(): LocalUser[] {
    return this.data.users;
  }

  findUserByEmail(email: string): LocalUser | undefined {
    const normalized = email.trim().toLowerCase();
    return this.data.users.find((u) => u.email.toLowerCase() === normalized);
  }

  findUserByUid(uid: string): LocalUser | undefined {
    return this.data.users.find((u) => u.uid === uid);
  }

  upsertUser(user: LocalUser): LocalUser {
    const idx = this.data.users.findIndex((u) => u.uid === user.uid);
    if (idx >= 0) {
      this.data.users[idx] = user;
    } else {
      this.data.users.push(user);
    }
    this.persist();
    return user;
  }

  getMarkersByOwner(ownerId: string): CustomMarker[] {
    return this.data.markers.filter((m) => m.ownerId === ownerId);
  }

  getMarkerById(id: string): CustomMarker | undefined {
    return this.data.markers.find((m) => m.id === id);
  }

  createMarker(marker: CustomMarker): CustomMarker {
    this.data.markers.push(marker);
    this.persist();
    return marker;
  }

  updateMarker(id: string, ownerId: string, patch: Partial<CustomMarker>): CustomMarker | null {
    const idx = this.data.markers.findIndex((m) => m.id === id);
    if (idx === -1) return null;
    if (this.data.markers[idx].ownerId !== ownerId) return null;
    this.data.markers[idx] = {
      ...this.data.markers[idx],
      ...patch,
      id: this.data.markers[idx].id,
      ownerId: this.data.markers[idx].ownerId,
      createdAt: this.data.markers[idx].createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.persist();
    return this.data.markers[idx];
  }

  deleteMarker(id: string, ownerId: string): boolean {
    const idx = this.data.markers.findIndex((m) => m.id === id);
    if (idx === -1) return false;
    if (this.data.markers[idx].ownerId !== ownerId) return false;
    this.data.markers.splice(idx, 1);
    this.persist();
    return true;
  }

  getSavedLocationsByOwner(ownerId: string): SavedLocation[] {
    return this.data.savedLocations.filter((l) => l.ownerId === ownerId);
  }

  createSavedLocation(loc: SavedLocation): SavedLocation {
    if (loc.isPrimary) {
      for (const existing of this.data.savedLocations) {
        if (existing.ownerId === loc.ownerId) {
          existing.isPrimary = false;
        }
      }
    }
    this.data.savedLocations.push(loc);
    this.persist();
    return loc;
  }

  setPrimarySavedLocation(id: string, ownerId: string): SavedLocation | null {
    const target = this.data.savedLocations.find((l) => l.id === id && l.ownerId === ownerId);
    if (!target) return null;
    for (const loc of this.data.savedLocations) {
      if (loc.ownerId === ownerId) {
        loc.isPrimary = loc.id === id;
      }
    }
    this.persist();
    return target;
  }

  deleteSavedLocation(id: string, ownerId: string): boolean {
    const idx = this.data.savedLocations.findIndex((l) => l.id === id && l.ownerId === ownerId);
    if (idx === -1) return false;
    this.data.savedLocations.splice(idx, 1);
    this.persist();
    return true;
  }

  getAlertRulesByOwner(ownerId: string): AlertRule[] {
    return this.data.alertRules.filter((r) => r.ownerId === ownerId);
  }

  getAllEnabledAlertRules(): AlertRule[] {
    return this.data.alertRules.filter((r) => r.enabled);
  }

  createAlertRule(rule: AlertRule): AlertRule {
    this.data.alertRules.push(rule);
    this.persist();
    return rule;
  }

  updateAlertRule(id: string, ownerId: string, patch: Partial<AlertRule>): AlertRule | null {
    const idx = this.data.alertRules.findIndex((r) => r.id === id && r.ownerId === ownerId);
    if (idx === -1) return null;
    this.data.alertRules[idx] = {
      ...this.data.alertRules[idx],
      ...patch,
      id: this.data.alertRules[idx].id,
      ownerId: this.data.alertRules[idx].ownerId,
      updatedAt: new Date().toISOString(),
    };
    this.persist();
    return this.data.alertRules[idx];
  }

  deleteAlertRule(id: string, ownerId: string): boolean {
    const idx = this.data.alertRules.findIndex((r) => r.id === id && r.ownerId === ownerId);
    if (idx === -1) return false;
    this.data.alertRules.splice(idx, 1);
    this.persist();
    return true;
  }

  getAlertsByOwner(ownerId: string): PollutionAlert[] {
    return this.data.alerts
      .filter((a) => a.ownerId === ownerId)
      .sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt));
  }

  hasRecentAlertWithDedupe(dedupeKey: string, cooldownMs: number): boolean {
    const now = Date.now();
    return this.data.alerts.some(
      (a) => a.dedupeKey === dedupeKey && now - Date.parse(a.triggeredAt) < cooldownMs
    );
  }

  createAlert(alert: PollutionAlert): PollutionAlert {
    this.data.alerts.unshift(alert);
    if (this.data.alerts.length > 500) {
      this.data.alerts = this.data.alerts.slice(0, 500);
    }
    this.persist();
    return alert;
  }

  updateAlertStatus(
    id: string,
    ownerId: string,
    status: 'active' | 'acknowledged' | 'dismissed'
  ): PollutionAlert | null {
    const idx = this.data.alerts.findIndex((a) => a.id === id && a.ownerId === ownerId);
    if (idx === -1) return null;
    this.data.alerts[idx].status = status;
    this.persist();
    return this.data.alerts[idx];
  }

  getIotDevices(): IotDevice[] {
    return this.data.iotDevices;
  }

  registerIotDevice(device: IotDevice): IotDevice {
    const idx = this.data.iotDevices.findIndex((d) => d.deviceId === device.deviceId);
    if (idx >= 0) {
      this.data.iotDevices[idx] = device;
    } else {
      this.data.iotDevices.push(device);
    }
    this.persist();
    return device;
  }

  addIotReading(reading: IotReading): IotReading {
    this.data.iotReadings.unshift(reading);
    if (this.data.iotReadings.length > 500) {
      this.data.iotReadings = this.data.iotReadings.slice(0, 500);
    }
    const dev = this.data.iotDevices.find((d) => d.deviceId === reading.deviceId);
    if (dev) {
      dev.lastReadingAt = reading.recordedAt;
    }
    this.persist();
    return reading;
  }

  getLatestIotReadings(): Array<{ device: IotDevice; latest: IotReading | null }> {
    return this.data.iotDevices.map((device) => {
      const latest = this.data.iotReadings.find((r) => r.deviceId === device.deviceId) ?? null;
      return { device, latest };
    });
  }

  getAdminSettings(): AdminSettings {
    return this.data.adminSettings;
  }

  updateAdminSettings(patch: Partial<AdminSettings>): AdminSettings {
    this.data.adminSettings = {
      ...this.data.adminSettings,
      ...patch,
    };
    this.persist();
    return this.data.adminSettings;
  }
}

export const dbStore = new PersistentStore();

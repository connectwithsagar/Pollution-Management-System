import { spawn } from 'child_process';
import path from 'path';
import { apiCache } from './cache.ts';
import type { HourlyPoint, StationNode } from './types.ts';

function runPythonScript<T>(scriptRelativePath: string, inputPayload: unknown, timeoutMs = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.resolve(process.cwd(), scriptRelativePath);
    const child = spawn('python3', [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Python script timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(`Python exited with ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as T);
      } catch (parseErr) {
        reject(new Error(`Invalid JSON from Python: ${String(parseErr)} (${stderr})`));
      }
    });

    child.stdin.write(JSON.stringify(inputPayload));
    child.stdin.end();
  });
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

export async function runAiForecast(params: {
  locationKey: string;
  target: string;
  horizon: number;
  history: HourlyPoint[];
  weatherForecast: HourlyPoint[];
  forceRetrain?: boolean;
}): Promise<ForecastResponse> {
  const cacheKey = `ai:${params.locationKey}:${params.target}:${params.horizon}`;
  if (params.forceRetrain) {
    const fresh = await runPythonScript<ForecastResponse>('ai/forecast_engine.py', {
      locationKey: params.locationKey,
      target: params.target,
      horizon: params.horizon,
      history: params.history,
      weatherForecast: params.weatherForecast,
    });
    apiCache.set(cacheKey, fresh, 300_000);
    return fresh;
  }

  const { value } = await apiCache.getOrFetch(cacheKey, 300_000, () =>
    runPythonScript<ForecastResponse>('ai/forecast_engine.py', {
      locationKey: params.locationKey,
      target: params.target,
      horizon: params.horizon,
      history: params.history,
      weatherForecast: params.weatherForecast,
    })
  );
  return value;
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

export async function runHotspotDetection(params: {
  pollutant: string;
  threshold?: number;
  epsKm?: number;
  points: StationNode[];
}): Promise<HotspotResponse> {
  return runPythonScript<HotspotResponse>('ai/hotspot_dbscan.py', {
    pollutant: params.pollutant,
    threshold: params.threshold,
    epsKm: params.epsKm ?? 8.5,
    minSamples: 2,
    points: params.points,
  });
}

# AetherGrid — AI-Based Smart City Pollution Management System

A full-stack, real-time environmental monitoring platform combining live ground sensor observations (Sensor.Community & optional OpenAQ v3), modeled atmospheric estimates (Open-Meteo CAMS & Weather), interactive Leaflet + OpenStreetMap geospatial mapping with manual marker creation, Python 3.10 Random Forest forecasting, Haversine DBSCAN hotspot detection, ESP32 IoT sensor ingestion, and WebSocket live push alerts.live athttps://pollution-management-system.onrender.com/

## Architecture Overview

- **Frontend (`src/`)**: React 19, TypeScript, Tailwind CSS v4 (dark & light themes), Leaflet + `leaflet.markercluster`, precision SVG telemetry charts, and `jsPDF` report generation.
- **Backend (`server.ts`, `backend/`)**: Express REST API + `ws` WebSocket server on port 3000, TTL response caching, rate limiting, Firebase ID Token + HMAC-SHA256 JWT authentication (`scrypt` password hashing), and Firestore/persistent store synchronization.
- **AI & Spatial Analytics (`ai/`)**:
  - `ai/forecast_engine.py`: Chronological Bagged Random Forest Regressor (70% train / 15% validation / 15% test split, zero future-data leakage) with MAE, RMSE, R², persistence baseline comparison, and saved model artifacts in `ai/artifacts/`.
  - `ai/hotspot_dbscan.py`: Haversine DBSCAN spatial clustering over observed stations and modeled grid cells with explicit surface provenance notices.
- **Database & Security (`firebase-blueprint.json`, `firestore.rules`)**: Firestore collections for user profiles, custom markers, saved locations, alert rules, alert history, and IoT sensors secured with strict owner-isolated rules.

## Local Development

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`.

## Running Automated Tests & Typechecks

```bash
npm run lint
npm test
npx eslint firestore.rules
```

## Production Build & Docker Deployment

```bash
npm run build
npm start
```

Or via Docker Compose:

```bash
docker compose up --build -d
```

## ESP32 IoT Sensor Ingestion Example

Register a device in **Admin & Settings** and POST readings to `/api/iot/readings`:

```bash
curl -X POST http://localhost:3000/api/iot/readings \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"esp32-node-alpha-01","pm2_5":19.4,"pm10":28.1,"temperature":21.2,"humidity":52}'
```

import { jsPDF } from 'jspdf';
import type { AirQualityReading, HotspotResponse, HourlyPoint } from '../types/env.ts';

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>
): void {
  const escapeCell = (val: string | number | null | undefined): string => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [
    headers.map(escapeCell).join(','),
    ...rows.map((r) => r.map(escapeCell).join(',')),
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportPollutionSummaryPdf(params: {
  title: string;
  locationName: string;
  lat: number;
  lon: number;
  current: AirQualityReading | null;
  hourly: HourlyPoint[];
  hotspots?: HotspotResponse | null;
}): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 44;
  let y = 52;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(15, 23, 42);
  doc.text('AetherGrid Environmental Intelligence Report', margin, y);

  y += 20;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Report: ${params.title}  |  Generated: ${new Date().toISOString()}`,
    margin,
    y
  );

  y += 16;
  doc.text(
    `Target Coordinates: ${params.locationName} (${params.lat.toFixed(4)}, ${params.lon.toFixed(4)})`,
    margin,
    y
  );

  y += 16;
  doc.text(
    `Data Attribution: ${params.current?.provider || 'Open-Meteo CAMS + Sensor.Community'}`,
    margin,
    y
  );

  y += 22;
  doc.setDrawColor(203, 213, 225);
  doc.line(margin, y, 550, y);
  y += 20;

  if (params.current) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text('Current Snapshot (Units: ug/m3 unless noted)', margin, y);
    y += 18;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const p = params.current.pollutants;
    const w = params.current.weather;
    const rows = [
      `US AQI: ${p.usAqi ?? 'Unavailable'}   |   EU AQI: ${p.euAqi ?? 'Unavailable'}   |   Source Type: ${params.current.sourceType}`,
      `PM2.5: ${p.pm2_5 ?? 'Unavailable'} ug/m3   |   PM10: ${p.pm10 ?? 'Unavailable'} ug/m3   |   NO2: ${p.no2 ?? 'Unavailable'} ug/m3`,
      `O3: ${p.o3 ?? 'Unavailable'} ug/m3   |   SO2: ${p.so2 ?? 'Unavailable'} ug/m3   |   CO: ${p.co ?? 'Unavailable'} ug/m3`,
      `Weather: Temp ${w.temperature ?? 'N/A'} C   |   Humidity ${w.humidity ?? 'N/A'}%   |   Wind ${w.windSpeed ?? 'N/A'} km/h`,
    ];
    for (const line of rows) {
      doc.text(line, margin, y);
      y += 16;
    }
  }

  if (params.hotspots && params.hotspots.hotspots.length > 0) {
    y += 10;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(
      `Detected Spatial Hotspots (${params.hotspots.pollutant.toUpperCase()} >= ${params.hotspots.threshold})`,
      margin,
      y
    );
    y += 16;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    for (const h of params.hotspots.hotspots.slice(0, 6)) {
      doc.text(
        `- ${h.label}: peak ${h.peakValue}, mean ${h.meanValue}, stations ${h.stationCount}, severity ${h.severity.toUpperCase()}`,
        margin,
        y
      );
      y += 14;
    }
  }

  if (params.hourly.length > 0) {
    y += 12;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Recent Hourly Telemetry Sample (Last 18 Hours UTC)', margin, y);
    y += 18;
    doc.setFont('courier', 'normal');
    doc.setFontSize(8.5);
    doc.text('Timestamp (UTC)       US_AQI   PM2.5   PM10    NO2     O3    Temp(C)', margin, y);
    y += 12;

    for (const row of params.hourly.slice(-18)) {
      if (y > 760) {
        doc.addPage();
        y = 48;
      }
      const line = `${row.timestamp.slice(0, 16).replace('T', ' ')}  ${String(row.usAqi ?? '--').padStart(6)}  ${String(row.pm2_5 ?? '--').padStart(6)}  ${String(row.pm10 ?? '--').padStart(6)}  ${String(row.no2 ?? '--').padStart(6)}  ${String(row.o3 ?? '--').padStart(6)}  ${String(row.temperature ?? '--').padStart(7)}`;
      doc.text(line, margin, y);
      y += 12;
    }
  }

  const safeName = params.locationName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
  doc.save(`AetherGrid_Report_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

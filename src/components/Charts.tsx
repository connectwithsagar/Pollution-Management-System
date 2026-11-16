import React, { useMemo, useState } from 'react';

export interface SeriesPoint {
  label: string;
  timestamp: string;
  observed?: number | null;
  forecast?: number | null;
  lower?: number | null;
  upper?: number | null;
}

export function TimeSeriesTelemetryChart({
  data,
  unit,
  observedLabel = 'Modeled / Observed',
  forecastLabel = 'AI Forecast',
  height = 260,
  threshold,
}: {
  data: SeriesPoint[];
  unit: string;
  observedLabel?: string;
  forecastLabel?: string;
  height?: number;
  threshold?: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const width = 760;
  const padL = 48;
  const padR = 20;
  const padT = 18;
  const padB = 34;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const { minVal, maxVal, obsPath, fcPath, bandPath, ticks } = useMemo(() => {
    const nums: number[] = [];
    for (const d of data) {
      if (d.observed !== null && d.observed !== undefined) nums.push(d.observed);
      if (d.forecast !== null && d.forecast !== undefined) nums.push(d.forecast);
      if (d.lower !== null && d.lower !== undefined) nums.push(d.lower);
      if (d.upper !== null && d.upper !== undefined) nums.push(d.upper);
    }
    if (threshold !== undefined) nums.push(threshold);
    if (nums.length === 0) {
      return {
        minVal: 0,
        maxVal: 100,
        obsPath: '',
        fcPath: '',
        bandPath: '',
        ticks: [0, 25, 50, 75, 100],
      };
    }

    const rawMin = Math.min(...nums);
    const rawMax = Math.max(...nums);
    const lo = Math.max(0, Math.floor(rawMin * 0.85));
    const hi = Math.max(lo + 5, Math.ceil(rawMax * 1.12));

    const xOf = (i: number) =>
      data.length <= 1 ? padL : padL + (i / (data.length - 1)) * plotW;
    const yOf = (v: number) => padT + plotH - ((v - lo) / (hi - lo)) * plotH;

    let obsD = '';
    let fcD = '';
    const upperPts: string[] = [];
    const lowerPts: string[] = [];

    data.forEach((pt, idx) => {
      const x = xOf(idx).toFixed(1);
      if (pt.observed !== null && pt.observed !== undefined) {
        obsD += `${obsD === '' ? 'M' : 'L'} ${x} ${yOf(pt.observed).toFixed(1)} `;
      }
      if (pt.forecast !== null && pt.forecast !== undefined) {
        fcD += `${fcD === '' ? 'M' : 'L'} ${x} ${yOf(pt.forecast).toFixed(1)} `;
      }
      if (
        pt.upper !== null &&
        pt.upper !== undefined &&
        pt.lower !== null &&
        pt.lower !== undefined
      ) {
        upperPts.push(`${x},${yOf(pt.upper).toFixed(1)}`);
        lowerPts.unshift(`${x},${yOf(pt.lower).toFixed(1)}`);
      }
    });

    const band =
      upperPts.length > 1
        ? `M ${upperPts.join(' L ')} L ${lowerPts.join(' L ')} Z`
        : '';

    const tickStep = (hi - lo) / 4;
    const tList = [0, 1, 2, 3, 4].map((k) => Number((lo + k * tickStep).toFixed(1)));

    return {
      minVal: lo,
      maxVal: hi,
      obsPath: obsD.trim(),
      fcPath: fcD.trim(),
      bandPath: band,
      ticks: tList,
    };
  }, [data, plotH, plotW, threshold]);

  if (data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center border border-dashed border-slate-300 dark:border-slate-800 rounded-lg text-sm text-slate-500 dark:text-slate-400">
        No telemetry data available for the selected range.
      </div>
    );
  }

  const xOf = (i: number) =>
    data.length <= 1 ? padL : padL + (i / (data.length - 1)) * plotW;
  const yOf = (v: number) => padT + plotH - ((v - minVal) / (maxVal - minVal)) * plotH;

  const activePoint = hoverIdx !== null ? data[hoverIdx] : null;
  const xStepIndices = [
    0,
    Math.floor(data.length * 0.25),
    Math.floor(data.length * 0.5),
    Math.floor(data.length * 0.75),
    data.length - 1,
  ].filter((v, i, arr) => v >= 0 && arr.indexOf(v) === i);

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-2 text-xs text-slate-600 dark:text-slate-400">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 h-0.5 bg-cyan-500" />
            <span>{observedLabel}</span>
          </span>
          {fcPath && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-4 h-0.5 border-b-2 border-dashed border-emerald-400" />
              <span>{forecastLabel}</span>
            </span>
          )}
          {threshold !== undefined && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-4 h-0.5 border-b border-dotted border-amber-500" />
              <span>Threshold ({threshold} {unit})</span>
            </span>
          )}
        </div>
        {activePoint && (
          <div className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {activePoint.label} ·{' '}
            {activePoint.observed !== null && activePoint.observed !== undefined
              ? `${activePoint.observed.toFixed(1)} ${unit}`
              : activePoint.forecast !== null && activePoint.forecast !== undefined
                ? `Forecast ${activePoint.forecast.toFixed(1)} ${unit}`
                : 'Unavailable'}
          </div>
        )}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto select-none overflow-visible"
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Horizontal grid lines */}
        {ticks.map((t, i) => {
          const y = yOf(t);
          return (
            <g key={i}>
              <line
                x1={padL}
                x2={width - padR}
                y1={y}
                y2={y}
                className="stroke-slate-200 dark:stroke-slate-800"
                strokeWidth="1"
              />
              <text
                x={padL - 8}
                y={y + 3}
                textAnchor="end"
                className="fill-slate-500 dark:fill-slate-400 text-[10px] font-mono"
              >
                {t}
              </text>
            </g>
          );
        })}

        {/* Threshold line */}
        {threshold !== undefined && threshold >= minVal && threshold <= maxVal && (
          <line
            x1={padL}
            x2={width - padR}
            y1={yOf(threshold)}
            y2={yOf(threshold)}
            stroke="#f59e0b"
            strokeWidth="1.25"
            strokeDasharray="4 4"
          />
        )}

        {/* Uncertainty band */}
        {bandPath && <path d={bandPath} fill="rgba(16, 185, 129, 0.14)" />}

        {/* Observed / Modeled solid curve */}
        {obsPath && (
          <path
            d={obsPath}
            fill="none"
            stroke="#06b6d4"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* AI Forecast dashed curve */}
        {fcPath && (
          <path
            d={fcPath}
            fill="none"
            stroke="#10b981"
            strokeWidth="2.2"
            strokeDasharray="6 4"
            strokeLinecap="round"
          />
        )}

        {/* X axis labels */}
        {xStepIndices.map((idx) => (
          <text
            key={idx}
            x={xOf(idx)}
            y={height - 10}
            textAnchor="middle"
            className="fill-slate-500 dark:fill-slate-400 text-[10px] font-mono"
          >
            {data[idx]?.label}
          </text>
        ))}

        {/* Interactive hover crosshair */}
        {hoverIdx !== null && data[hoverIdx] && (
          <g>
            <line
              x1={xOf(hoverIdx)}
              x2={xOf(hoverIdx)}
              y1={padT}
              y2={padT + plotH}
              className="stroke-slate-400 dark:stroke-slate-600"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            {data[hoverIdx].observed !== null && data[hoverIdx].observed !== undefined && (
              <circle
                cx={xOf(hoverIdx)}
                cy={yOf(data[hoverIdx].observed!)}
                r="4"
                fill="#06b6d4"
                stroke="#070b14"
                strokeWidth="1.5"
              />
            )}
            {data[hoverIdx].forecast !== null && data[hoverIdx].forecast !== undefined && (
              <circle
                cx={xOf(hoverIdx)}
                cy={yOf(data[hoverIdx].forecast!)}
                r="4"
                fill="#10b981"
                stroke="#070b14"
                strokeWidth="1.5"
              />
            )}
          </g>
        )}

        {/* Invisible hit targets */}
        {data.map((_, idx) => {
          const sliceW = plotW / Math.max(1, data.length);
          return (
            <rect
              key={idx}
              x={xOf(idx) - sliceW / 2}
              y={padT}
              width={Math.max(4, sliceW)}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(idx)}
            />
          );
        })}
      </svg>
    </div>
  );
}

export function BarDistributionChart({
  items,
  unit,
  height = 220,
}: {
  items: Array<{ label: string; value: number; color?: string }>;
  unit: string;
  height?: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (items.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        No distribution data available.
      </div>
    );
  }

  const width = 620;
  const padL = 44;
  const padR = 16;
  const padT = 16;
  const padB = 34;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const maxVal = Math.max(10, ...items.map((i) => i.value)) * 1.15;
  const barGap = 6;
  const barW = Math.max(6, (plotW - barGap * items.length) / items.length);

  return (
    <div className="w-full">
      <div className="flex justify-end h-5 text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
        {hoverIdx !== null && items[hoverIdx]
          ? `${items[hoverIdx].label}: ${items[hoverIdx].value.toFixed(1)} ${unit}`
          : ''}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
        {[0, 0.25, 0.5, 0.75, 1].map((frac, idx) => {
          const y = padT + plotH * (1 - frac);
          return (
            <g key={idx}>
              <line
                x1={padL}
                x2={width - padR}
                y1={y}
                y2={y}
                className="stroke-slate-200 dark:stroke-slate-800"
                strokeWidth="1"
              />
              <text
                x={padL - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-slate-500 dark:fill-slate-400 text-[10px] font-mono"
              >
                {(maxVal * frac).toFixed(0)}
              </text>
            </g>
          );
        })}

        {items.map((item, idx) => {
          const x = padL + idx * (barW + barGap);
          const barH = (item.value / maxVal) * plotH;
          const y = padT + plotH - barH;
          return (
            <g
              key={item.label}
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx(null)}
            >
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(2, barH)}
                rx="3"
                fill={item.color || '#06b6d4'}
                opacity={hoverIdx === null || hoverIdx === idx ? 0.92 : 0.45}
              />
              {(items.length <= 14 || idx % 3 === 0) && (
                <text
                  x={x + barW / 2}
                  y={height - 10}
                  textAnchor="middle"
                  className="fill-slate-500 dark:fill-slate-400 text-[9px] font-mono"
                >
                  {item.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function ScatterCorrelationChart({
  points,
  xLabel,
  yLabel,
  height = 220,
}: {
  points: Array<{ x: number; y: number; label: string }>;
  xLabel: string;
  yLabel: string;
  height?: number;
}) {
  if (points.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        Insufficient paired weather and pollutant readings.
      </div>
    );
  }

  const width = 560;
  const padL = 46;
  const padR = 16;
  const padT = 16;
  const padB = 34;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(minX + 1, Math.max(...xs));
  const minY = Math.max(0, Math.min(...ys) * 0.9);
  const maxY = Math.max(minY + 1, Math.max(...ys) * 1.1);

  const sx = (v: number) => padL + ((v - minX) / (maxX - minX)) * plotW;
  const sy = (v: number) => padT + plotH - ((v - minY) / (maxY - minY)) * plotH;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
      <line
        x1={padL}
        x2={width - padR}
        y1={padT + plotH}
        y2={padT + plotH}
        className="stroke-slate-300 dark:stroke-slate-700"
      />
      <line
        x1={padL}
        x2={padL}
        y1={padT}
        y2={padT + plotH}
        className="stroke-slate-300 dark:stroke-slate-700"
      />
      <text
        x={width / 2}
        y={height - 6}
        textAnchor="middle"
        className="fill-slate-500 dark:fill-slate-400 text-[10px] font-mono"
      >
        {xLabel}
      </text>
      <text
        x={12}
        y={height / 2}
        textAnchor="middle"
        transform={`rotate(-90 12 ${height / 2})`}
        className="fill-slate-500 dark:fill-slate-400 text-[10px] font-mono"
      >
        {yLabel}
      </text>
      {points.map((pt, i) => (
        <circle
          key={i}
          cx={sx(pt.x)}
          cy={sy(pt.y)}
          r="3.5"
          fill="#06b6d4"
          fillOpacity="0.65"
          stroke="#0891b2"
          strokeWidth="1"
        >
          <title>{`${pt.label}: ${xLabel}=${pt.x.toFixed(1)}, ${yLabel}=${pt.y.toFixed(1)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

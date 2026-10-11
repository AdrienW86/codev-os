"use client";

import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import type { TrendPoint } from "@/lib/analytics/view-model";

const nf = new Intl.NumberFormat("fr-FR");

/** Mini-courbe des cartes KPI. Sans série, rien n'est dessiné (pas de tendance inventée). */
export function Sparkline({ values, color }: { values: number[]; color: string }) {
  const id = useId();
  if (values.length < 2) return <div className="h-8" aria-hidden="true" />;
  const width = 120, height = 32, pad = 3;
  const max = Math.max(...values), min = Math.min(...values);
  const range = max - min || 1;
  const points = values.map((value, index) => [pad + (index / (values.length - 1)) * (width - pad * 2), height - pad - ((value - min) / range) * (height - pad * 2)]);
  const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-8 w-full max-w-[120px]" aria-hidden="true" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopOpacity="0.35" style={{ stopColor: color }} />
          <stop offset="100%" stopOpacity="0" style={{ stopColor: color }} />
        </linearGradient>
      </defs>
      <path d={`${line} L${last[0]} ${height} L${points[0][0]} ${height} Z`} fill={`url(#spark-${id})`} />
      <path d={line} fill="none" style={{ stroke: color }} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="2.2" style={{ fill: color }} />
    </svg>
  );
}

function niceMax(value: number) {
  if (value <= 5) return 5;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value / 4) ?? 10;
  return Math.ceil(value / (step * magnitude)) * step * magnitude;
}

/**
 * Graphique principal (aire + courbe). `previous` superpose la période précédente en pointillés ;
 * `partialLast` dessine le dernier segment en pointillés (journée en cours, incomplète).
 */
export function TrafficChart({ points, previous, partialLast, label, metricLabel }: { points: TrendPoint[]; previous?: TrendPoint[]; partialLast?: boolean; label: string; metricLabel: string }) {
  const gradientId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(960);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const height = width < 640 ? 220 : 260;
  const padLeft = 36, padRight = 16, padTop = 16, padBottom = 30;
  const plotW = width - padLeft - padRight, plotH = height - padTop - padBottom;
  const compare = previous && previous.length ? previous.slice(-points.length) : [];
  const max = niceMax(Math.max(1, ...points.map((point) => point.value), ...compare.map((point) => point.value)));
  const x = (index: number, count = points.length) => padLeft + (count <= 1 ? plotW / 2 : (index / (count - 1)) * plotW);
  const y = (value: number) => padTop + plotH - (value / max) * plotH;
  const coords = points.map((point, index) => ({ x: x(index), y: y(point.value), point }));
  const path = (items: { x: number; y: number }[]) => items.map((item, index) => `${index ? "L" : "M"}${item.x.toFixed(1)} ${item.y.toFixed(1)}`).join(" ");
  const solid = partialLast && coords.length > 2 ? coords.slice(0, -1) : coords;
  const dashed = partialLast && coords.length > 2 ? coords.slice(-2) : [];
  const area = coords.length ? `${path(coords)} L${coords[coords.length - 1].x} ${padTop + plotH} L${coords[0].x} ${padTop + plotH} Z` : "";
  const previousCoords = compare.map((point, index) => ({ x: x(index + (points.length - compare.length), points.length), y: y(point.value) }));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(max * ratio * 100) / 100);
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / 90))));
  const active = hover !== null ? coords[hover] : null;

  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!coords.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - bounds.left) / bounds.width) * width;
    let nearest = 0;
    coords.forEach((item, index) => { if (Math.abs(item.x - px) < Math.abs(coords[nearest].x - px)) nearest = index; });
    setHover(nearest);
  };

  return (
    <div ref={ref} className="relative w-full min-w-0 overflow-hidden">
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="block touch-pan-y" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopOpacity="0.32" style={{ stopColor: "var(--chart-1)" }} />
            <stop offset="100%" stopOpacity="0" style={{ stopColor: "var(--chart-1)" }} />
          </linearGradient>
        </defs>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={padLeft} x2={width - padRight} y1={y(tick)} y2={y(tick)} className="stroke-border" strokeDasharray={tick === 0 ? undefined : "2 4"} />
            <text x={padLeft - 8} y={y(tick) + 4} textAnchor="end" className="fill-subtle text-[11px] tabular-nums">{nf.format(tick)}</text>
          </g>
        ))}
        {area && <path d={area} fill={`url(#${gradientId})`} />}
        {previousCoords.length > 1 && <path d={path(previousCoords)} fill="none" className="stroke-chart-muted" strokeWidth="1.5" strokeDasharray="4 5" strokeLinecap="round" />}
        {solid.length > 0 && <path d={path(solid)} fill="none" className="stroke-chart-1" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
        {dashed.length > 1 && <path d={path(dashed)} fill="none" className="stroke-chart-1" strokeWidth="2" strokeDasharray="5 5" strokeLinecap="round" />}
        {coords.length <= 31 && coords.map((item) => <circle key={item.point.key} cx={item.x} cy={item.y} r="3.5" className="fill-accent-hover stroke-surface" strokeWidth="2" />)}
        {coords.map((item, index) => index === coords.length - 1 || (index % labelEvery === 0 && coords.length - 1 - index >= labelEvery * 0.6) ? (
          <text key={`label-${item.point.key}`} x={item.x} y={height - 8} textAnchor="middle" className="fill-subtle text-[11px]">{item.point.label}</text>
        ) : null)}
        {active && <>
          <line x1={active.x} x2={active.x} y1={padTop} y2={padTop + plotH} className="stroke-border-strong" />
          <circle cx={active.x} cy={active.y} r="5" className="fill-accent-hover stroke-accent-strong" strokeWidth="2" />
        </>}
      </svg>
      {active && hover !== null && (
        <div className="pointer-events-none absolute top-2 rounded-lg border border-border-strong bg-surface-raised/95 px-3 py-2 text-xs shadow-popover" style={{ left: Math.min(Math.max(active.x - 70, 0), width - 150) }}>
          <p className="text-muted">{active.point.label}</p>
          <p className="mt-0.5 font-semibold text-foreground tabular-nums">{nf.format(active.point.value)} <span className="font-normal text-muted">{metricLabel}</span></p>
          {previousCoords.length > 0 && compare[hover - (points.length - compare.length)] && (
            <p className="mt-0.5 text-subtle tabular-nums">Période préc. : {nf.format(compare[hover - (points.length - compare.length)].value)}</p>
          )}
        </div>
      )}
      {!points.length && <div className="absolute inset-0 grid place-items-center text-sm text-muted">Aucune série temporelle pour cette période.</div>}
    </div>
  );
}

/** Anneau de répartition (appareils). */
export function Donut({ segments, total, caption }: { segments: { label: string; value: number; color: string }[]; total: number; caption: string }) {
  const radius = 52, stroke = 14, circumference = 2 * Math.PI * radius;
  const sum = segments.reduce((acc, segment) => acc + segment.value, 0) || 1;
  const arcs = segments.map((segment, index) => ({
    ...segment,
    length: (segment.value / sum) * circumference,
    offset: segments.slice(0, index).reduce((acc, item) => acc + (item.value / sum) * circumference, 0),
  }));
  return (
    <div className="relative h-36 w-36 shrink-0">
      <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90" role="img" aria-label={segments.map((segment) => `${segment.label} ${Math.round((segment.value / sum) * 100)} %`).join(", ")}>
        <circle cx="70" cy="70" r={radius} fill="none" className="stroke-surface-raised" strokeWidth={stroke} />
        {arcs.map((arc) => (
          <circle key={arc.label} cx="70" cy="70" r={radius} fill="none" strokeWidth={stroke} strokeDasharray={`${Math.max(0, arc.length - 2)} ${circumference}`} strokeDashoffset={-arc.offset} style={{ stroke: arc.color }} />
        ))}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-2xl font-semibold tabular-nums text-foreground">{nf.format(total)}</p>
          <p className="text-[11px] text-muted">{caption}</p>
        </div>
      </div>
    </div>
  );
}

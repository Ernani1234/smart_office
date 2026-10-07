import { useEffect, useRef, useState, type ReactNode } from 'react';
import { clockTime } from '../lib/format';

// Gráficos em SVG seguindo o método de dataviz: uma série por gráfico (o título
// nomeia a série, sem caixa de legenda), linha de 2px com lavagem a 10%,
// marcador final de 8px com anel na cor da superfície, rótulo só no fim,
// grade de linhas finas sólidas, crosshair com tooltip, e visão em tabela.

export const CHART = {
  surface: '#1b1832',
  grid: '#2a2648',
  axis: '#3d3866',
  muted: '#8e89b8',
  secondary: '#bcb8dc',
  primary: '#e8e5ff',
  series1: '#3987e5',
  series2: '#d95926',
  series3: '#199e70',
};

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => setW(Math.floor(entries[0].contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Ticks "redondos" (0, 25, 50…) cobrindo [min, max]. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    max = min + 1;
  }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

export interface Point {
  t: number;
  v: number;
}

export function LineChart({
  points,
  color,
  height = 190,
  format,
  reference,
  emptyText = 'Sem dados ainda',
}: {
  points: Point[];
  color: string;
  height?: number;
  format: (v: number) => string;
  reference?: { value: number; label: string };
  emptyText?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 56, r: 64, t: 12, b: 26 };
  if (points.length < 2 || width === 0) {
    return (
      <div ref={ref} className="grid place-items-center text-sm text-ink-400" style={{ height }}>
        {points.length < 2 ? emptyText : null}
      </div>
    );
  }
  const t0 = points[0].t;
  const t1 = Math.max(points[points.length - 1].t, t0 + 1);
  const values = points.map((p) => p.v);
  const lo = Math.min(0, ...values, reference?.value ?? 0);
  const hi = Math.max(...values, reference?.value ?? -Infinity, lo + 0.01);
  // Um negativo minúsculo (gasto antes da primeira venda) não merece um tick inteiro.
  const tinyDip = lo < 0 && -lo < (hi - lo) * 0.08;
  const ticks = niceTicks(tinyDip ? 0 : lo, hi, 4);
  const yMin = Math.min(ticks[0], lo);
  const yMax = ticks[ticks.length - 1];
  const iw = Math.max(10, width - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * iw;
  const y = (v: number) => pad.t + (1 - (v - yMin) / (yMax - yMin || 1)) * ih;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = `${path} L${x(points[points.length - 1].t).toFixed(1)},${y(Math.max(yMin, 0)).toFixed(1)} L${x(t0).toFixed(1)},${y(Math.max(yMin, 0)).toFixed(1)} Z`;
  const xTicks = [0, 0.33, 0.66, 1].map((f) => t0 + f * (t1 - t0));
  const last = points[points.length - 1];
  const hp = hover !== null ? points[hover] : null;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const t = t0 + ((px - pad.l) / iw) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i].t - t) < Math.abs(points[best].t - t)) best = i;
    setHover(best);
  };

  return (
    <div ref={ref} className="relative" style={{ height }}>
      <svg width={width} height={height} onPointerMove={onMove} onPointerLeave={() => setHover(null)} className="block">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={pad.l + iw} y1={y(v)} y2={y(v)} stroke={v === 0 ? CHART.axis : CHART.grid} strokeWidth={1} />
            <text x={pad.l - 8} y={y(v) + 3.5} textAnchor="end" fontSize={10.5} fill={CHART.muted} className="tabular">
              {format(v)}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text
            key={i}
            x={x(t)}
            y={height - 8}
            textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
            fontSize={10.5}
            fill={CHART.muted}
          >
            {clockTime(t).slice(0, 5)}
          </text>
        ))}
        {reference && reference.value >= yMin && reference.value <= yMax && (
          <g>
            <line
              x1={pad.l}
              x2={pad.l + iw}
              y1={y(reference.value)}
              y2={y(reference.value)}
              stroke={CHART.secondary}
              strokeWidth={1}
              opacity={0.6}
            />
            <text x={pad.l + iw + 6} y={y(reference.value) + 3.5} fontSize={10.5} fill={CHART.secondary}>
              {reference.label}
            </text>
          </g>
        )}
        <path d={area} fill={color} opacity={0.1} />
        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(last.t)} cy={y(last.v)} r={4} fill={color} stroke={CHART.surface} strokeWidth={2} />
        <text x={x(last.t) + 8} y={y(last.v) + 4} fontSize={11.5} fontWeight={600} fill={CHART.primary}>
          {format(last.v)}
        </text>
        {hp && (
          <g pointerEvents="none">
            <line x1={x(hp.t)} x2={x(hp.t)} y1={pad.t} y2={pad.t + ih} stroke={CHART.secondary} strokeWidth={1} opacity={0.5} />
            <circle cx={x(hp.t)} cy={y(hp.v)} r={4} fill={color} stroke={CHART.surface} strokeWidth={2} />
          </g>
        )}
      </svg>
      {hp && (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-lg border border-ink-500 bg-ink-800/95 px-2.5 py-1.5 shadow-xl"
          style={{ left: Math.min(width - 150, Math.max(0, x(hp.t) + 10)) }}
        >
          <div className="text-[13px] font-semibold text-ink-100">{format(hp.v)}</div>
          <div className="flex items-center gap-1.5 text-[10.5px] text-ink-300">
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: color }} />
            {clockTime(hp.t)}
          </div>
        </div>
      )}
    </div>
  );
}

export interface BarRow {
  label: ReactNode;
  key: string;
  value: number;
}

/** Barras horizontais de cor única (categorias nominais), valor na ponta. */
export function BarList({
  rows,
  color,
  format,
  empty = 'Sem dados',
}: {
  rows: BarRow[];
  color: string;
  format: (v: number) => string;
  empty?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(...rows.map((r) => r.value), 0);
  const labelW = 132;
  const valueW = 78;
  const barW = Math.max(10, width - labelW - valueW - 12);
  if (!rows.length)
    return (
      <div ref={ref} className="py-6 text-center text-sm text-ink-400">
        {empty}
      </div>
    );
  return (
    <div ref={ref} className="space-y-1.5">
      {rows.map((r) => {
        const w = max > 0 ? Math.max(2, (r.value / max) * barW) : 2;
        return (
          <div
            key={r.key}
            className="relative flex items-center gap-2"
            onPointerEnter={() => setHover(r.key)}
            onPointerLeave={() => setHover(null)}
            tabIndex={0}
            onFocus={() => setHover(r.key)}
            onBlur={() => setHover(null)}
          >
            <div className="truncate text-[12px] text-ink-200" style={{ width: labelW }}>
              {r.label}
            </div>
            <div className="relative h-[14px]" style={{ width: barW }}>
              <div
                className="absolute inset-y-0 left-0 transition-[width] duration-500"
                style={{
                  width: w,
                  background: color,
                  borderRadius: '0 4px 4px 0',
                  filter: hover === r.key ? 'brightness(1.18)' : undefined,
                }}
              />
              <span className="absolute top-1/2 -translate-y-1/2 pl-1.5 text-[11.5px] font-medium text-ink-100 tabular" style={{ left: w }}>
                {format(r.value)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="max-h-64 overflow-auto rounded-lg border border-ink-600/60">
      <table className="w-full text-[12px]">
        <thead className="sticky top-0 bg-ink-800">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={`px-3 py-1.5 font-medium text-ink-300 ${i > 0 ? 'text-right' : 'text-left'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-ink-700/60">
              {r.map((c, j) => (
                <td key={j} className={`px-3 py-1 tabular ${j > 0 ? 'text-right text-ink-100' : 'text-ink-200'}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { Bar as BarDatum } from '@/lib/aggregate';
import { planTicks } from '@/lib/format';

export default function BarChartCard({ title, data, horizontal = false, height = 220, note, tickFormatter, compact = false }: { title: string; data: BarDatum[]; horizontal?: boolean; height?: number; note?: string; tickFormatter?: (label: string) => string; compact?: boolean }) {
  // Chart colours come from the CSS custom properties so the light/dark palette in
  // globals.css is the single source of truth. Hardcoding hex here would leave dark
  // mode with a light-mode chart on a dark page. Read on mount, not at module scope,
  // because the properties do not exist during server rendering.
  const [accent, setAccent] = useState('#0060df');
  const [grid, setGrid] = useState('#e3e6ec');
  const [cursorFill, setCursorFill] = useState('#eef0f4');
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    const a = cs.getPropertyValue('--accent').trim();
    const g = cs.getPropertyValue('--line').trim();
    const c = cs.getPropertyValue('--bg-3').trim();
    if (a) setAccent(a);
    if (g) setGrid(g);
    if (c) setCursorFill(c);
  }, []);

  // The x-axis tick count/angle has to react to the chart's actual rendered width, not
  // just data length -- a fixed "every Nth label" rule collides badly once the card is
  // narrower than the label text needs (this was the bug: month labels rendering as one
  // unreadable smear). Measure the wrapper with ResizeObserver and re-plan on resize.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(entries => { const w = entries[0]?.contentRect.width; if (w) setWidth(w); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!data.length) return null;
  const h = horizontal ? Math.max(height, data.length * 26 + 30) : height;
  const labels = data.map(d => (tickFormatter ? tickFormatter(d.label) : d.label));
  const { interval, angle } = horizontal ? { interval: 0, angle: 0 } : planTicks(labels, Math.max(0, width - 50));
  const angled = angle !== 0;

  return (
    <div className={`chart${compact ? ' chart-compact' : ''}`}>
      <h3>{title}</h3>
      <div className="chart-inner" ref={wrapRef}>
        <ResponsiveContainer width="100%" height={h + (angled ? 26 : 0)}>
          <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 4, right: 8, bottom: angled ? 26 : 4, left: horizontal ? 8 : 0 }}>
            <CartesianGrid stroke={grid} vertical={horizontal} horizontal={!horizontal} />
            {horizontal
              ? <><XAxis type="number" allowDecimals={false} domain={[0, 'auto']} tick={{ fontSize: 12 }} /><YAxis type="category" dataKey="label" width={260} tick={{ fontSize: 12 }} interval={0} /></>
              : <><XAxis
                  dataKey="label"
                  tick={{ fontSize: 11 }}
                  tickFormatter={tickFormatter}
                  interval={interval}
                  angle={angle}
                  textAnchor={angled ? 'end' : 'middle'}
                  height={angled ? 44 : 30}
                  dy={angled ? 2 : 6}
                /><YAxis allowDecimals={false} domain={[0, 'auto']} tick={{ fontSize: 12 }} width={44} /></>}
            <Tooltip
              cursor={{ fill: cursorFill }}
              formatter={(v) => (typeof v === 'number' ? v.toLocaleString('en-US') : v)}
              labelFormatter={tickFormatter ? (l) => tickFormatter(String(l)) : undefined}
            />
            <Bar dataKey="value" fill={accent} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {note && <div className="small">{note}</div>}
    </div>
  );
}

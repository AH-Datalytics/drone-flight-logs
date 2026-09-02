'use client';
import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { Bar as BarDatum } from '@/lib/aggregate';

export default function BarChartCard({ title, data, horizontal = false, height = 220, note }: { title: string; data: BarDatum[]; horizontal?: boolean; height?: number; note?: string }) {
  // Chart colours come from the CSS custom properties so the light/dark palette in
  // globals.css is the single source of truth. Hardcoding hex here would leave dark
  // mode with a light-mode chart on a dark page. Read on mount, not at module scope,
  // because the properties do not exist during server rendering.
  const [accent, setAccent] = useState('#0060df');
  const [grid, setGrid] = useState('#e3e6ec');
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    const a = cs.getPropertyValue('--accent').trim();
    const g = cs.getPropertyValue('--line').trim();
    if (a) setAccent(a);
    if (g) setGrid(g);
  }, []);
  if (!data.length) return null;
  const h = horizontal ? Math.max(height, data.length * 26 + 30) : height;
  return (
    <div className="chart">
      <h3>{title}</h3>
      <ResponsiveContainer width="100%" height={h}>
        <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 4, right: 8, bottom: 4, left: horizontal ? 8 : 0 }}>
          <CartesianGrid stroke={grid} vertical={horizontal} horizontal={!horizontal} />
          {horizontal
            ? <><XAxis type="number" allowDecimals={false} domain={[0, 'auto']} tick={{ fontSize: 12 }} /><YAxis type="category" dataKey="label" width={220} tick={{ fontSize: 12 }} interval={0} /></>
            : <><XAxis dataKey="label" tick={{ fontSize: 11 }} interval={data.length > 18 ? Math.ceil(data.length / 12) - 1 : 0} /><YAxis allowDecimals={false} domain={[0, 'auto']} tick={{ fontSize: 12 }} width={44} /></>}
          <Tooltip cursor={{ fill: '#f6f6f4' }} formatter={(v) => (typeof v === 'number' ? v.toLocaleString('en-US') : v)} />
          <Bar dataKey="value" fill={accent} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      {note && <div className="small">{note}</div>}
    </div>
  );
}

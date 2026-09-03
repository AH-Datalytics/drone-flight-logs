'use client';
import { useMemo, useRef, useState, useId } from 'react';
import { useRouter } from 'next/navigation';
import { fmtInt } from '@/lib/format';

export type SearchItem = { agency_id: string; display_name: string; state: string | null; flight_count: number };

/**
 * Type-to-find over every agency on the site.
 *
 * A plain select with two hundred and twenty-six options is unusable, so this
 * is a combobox: it filters as you type, matches on the agency name or its
 * state, and goes straight to the agency page. Arrow keys and Enter work
 * because a reader who knows the department they want should not have to
 * reach for the mouse.
 */
export default function AgencySearch({ items }: { items: SearchItem[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items.slice(0, 12);
    const scored = items
      .map(a => {
        const name = a.display_name.toLowerCase();
        const at = name.indexOf(needle);
        const stateHit = a.state?.toLowerCase() === needle;
        if (at === -1 && !stateHit) return null;
        // A name that starts with what was typed comes first, then earlier
        // matches, then the bigger agency.
        const rank = stateHit && at === -1 ? 3 : at === 0 ? 0 : 1;
        return { a, rank, at: at === -1 ? 999 : at };
      })
      .filter((x): x is { a: SearchItem; rank: number; at: number } => x !== null)
      .sort((x, y) => x.rank - y.rank || x.at - y.at || y.a.flight_count - x.a.flight_count);
    return scored.slice(0, 12).map(s => s.a);
  }, [q, items]);

  const go = (item: SearchItem | undefined) => {
    if (!item) return;
    setOpen(false);
    router.push(`/agency/${item.agency_id}`);
  };

  return (
    <div className="agency-search">
      <label htmlFor={`${listId}-input`}>Find an agency</label>
      <div className="agency-search-box">
        <input
          id={`${listId}-input`}
          type="text"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
          placeholder="Type an agency, city or state — e.g. Cincinnati, or TX"
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 120); }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(i => Math.min(i + 1, results.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); go(results[active]); }
            else if (e.key === 'Escape') { setOpen(false); }
          }}
        />
        {q && <button type="button" className="agency-search-clear" onClick={() => { setQ(''); setActive(0); }} aria-label="Clear">×</button>}
      </div>

      {open && results.length > 0 && (
        <ul className="agency-search-list" id={listId} role="listbox">
          {results.map((a, i) => (
            <li
              key={a.agency_id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'is-active' : undefined}
              onMouseEnter={() => setActive(i)}
              onMouseDown={e => { e.preventDefault(); if (blurTimer.current) clearTimeout(blurTimer.current); go(a); }}
            >
              <span className="agency-search-name">{a.display_name}</span>
              <span className="agency-search-meta">{a.state ?? ''} &nbsp; {fmtInt(a.flight_count)}</span>
            </li>
          ))}
        </ul>
      )}
      {open && q.trim() && results.length === 0 && (
        <ul className="agency-search-list" role="listbox" aria-label="No matches">
          <li role="option" aria-selected={false} className="is-empty">
            No agency matches “{q.trim()}”. Only agencies that publish a flight log appear here.
          </li>
        </ul>
      )}
    </div>
  );
}

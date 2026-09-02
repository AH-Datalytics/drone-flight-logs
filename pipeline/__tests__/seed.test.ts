import { describe, it, expect } from 'vitest';
import { parseSeedCsv, isInternalTitle, buildSeedRegistry } from '../seed.js';

const CSV = `agency,org_type,state_hint,flights,first_flight,last_flight,days_since_last_flight,active_days,flights_per_active_day,total_flight_hours,median_duration_min,median_straight_line_mi,pct_with_item_number,pct_night_2200_0559,pct_training_testing,distinct_purpose_values,top_purpose_category,top_category_pct,vanity_url,vanity_page_enabled,dashboard_url,skydio_org_id
Milwaukee Police Department,law_enforcement,,4562,2025-03-08,2026-08-23,9,300,15.2,980.1,13.5,0.5,93.7,12,12.5,12,weapons_gunfire,31.8,https://cloud.skydio.com/dashboard/milwaukee,true,https://www.arcgis.com/apps/dashboards/81fc8f0745944ddfbf773850cf28eca8,b438cee6-dca6-4104-ac75-c9b5f4c9c567
"Calcasieu Parish Sheriff's Office",law_enforcement,,188,2026-01-01,2026-08-01,31,50,3.7,40,12,0.4,50,10,5,4,call_for_service_general,60,https://cloud.skydio.com/dashboard/cpso,true,https://www.arcgis.com/apps/dashboards/d121145f41bc46fb8ae2dc6dcbe0b293,00a1a479-73f8-4394-b5ae-8e30d6ea2b47
`;

describe('parseSeedCsv', () => {
  it('parses quoted fields and keys by org id', () => {
    const m = parseSeedCsv(CSV);
    expect(m.size).toBe(2);
    const cp = m.get('00a1a479-73f8-4394-b5ae-8e30d6ea2b47')!;
    expect(cp.agency).toBe("Calcasieu Parish Sheriff's Office");
    expect(cp.vanity_url).toBe('https://cloud.skydio.com/dashboard/cpso');
    expect(cp.org_type).toBe('law_enforcement');
  });
});

describe('isInternalTitle', () => {
  it('flags Skydio internal and demo dashboards', () => {
    for (const t of ['INT - Jason LaFond Drone Flights', 'lNT - SE X10 Docks', '[Paraverse] DroneTag Drone Flights', '[TEMPLATE] Skydio Transparency Dashboard', 'DFR Summit June 2025 - Paraverse Org  Drone Flights', 'Synthetic Transparency Dashboard', 'Vincent Prototype dashboard', 'Skydio Transparency Dashboard - Dev Test 2', 'Axon Demo Sim Drone Flights', 'New Dashboard: INT - Dock Warehouse [Dev Testing 2]', 'JP-INT-Takuya G47 (Beta) SIM Drone Flights', 'joejoeDrones Flights', 'INT- Axon Week 2025 - Pathfinder Drone Flights', 'Skydio Transparency Dashboard', 'Skydio Transparency Dashboard 123', '[VINCENT COPY FOR EXPERIMENT] Denver Police Department Drone as First Responder Flights'])
      expect(isInternalTitle(t), t).toBe(true);
  });
  it('does not flag real agencies', () => {
    for (const t of ['Milwaukee Police Department', 'Skydio Fire Service Working Group ', 'INT - Reading Enterprises Drone Flights'.replace('INT - ', 'Reading Enterprises '), 'Axon Air PSM Drone Flights', 'Cincinnati Police Department Drone Flights'])
      expect(isInternalTitle(t), t).toBe(false);
  });
});

describe('buildSeedRegistry', () => {
  it('marks seeded agencies ok with vanity url, unknown as needs_review, internal as excluded', () => {
    const discovered = [
      { item_id: '81fc8f0745944ddfbf773850cf28eca8', title: ' Milwaukee Police Department', org_uuid: 'b438cee6-dca6-4104-ac75-c9b5f4c9c567', modified: '2026-08-27T00:00:00.000Z' },
      { item_id: 'aaaa', title: 'Newville Police Department (WA) Drone Flights', org_uuid: 'u-new', modified: '2026-08-27T00:00:00.000Z' },
      { item_id: 'bbbb', title: 'INT - Someone Drone Flights', org_uuid: 'u-int', modified: '2026-08-27T00:00:00.000Z' },
    ];
    const { registry, excluded } = buildSeedRegistry(discovered, parseSeedCsv(CSV), new Map([['b438cee6-dca6-4104-ac75-c9b5f4c9c567', { lon: -87.95, lat: 43.05 }]]), new Date('2026-09-01T00:00:00Z'));
    const mke = registry.agencies.find(a => a.agency_id === 'milwaukee-pd')!;
    expect(mke.status).toBe('ok'); expect(mke.official_url).toBe('https://cloud.skydio.com/dashboard/milwaukee'); expect(mke.timezone).toBe('America/Chicago');
    expect((mke.source_config as any).vanity_slug).toBe('milwaukee');
    const nv = registry.agencies.find(a => a.agency_id === 'newville-pd-wa')!;
    expect(nv.status).toBe('needs_review'); expect(nv.timezone).toBe('UTC'); expect(nv.notes).toMatch(/timezone not detected/);
    expect(excluded).toEqual([{ dashboard_item_id: 'bbbb', org_uuid: 'u-int', title: 'INT - Someone Drone Flights', reason: 'skydio internal or demo (title pattern)' }]);
    expect(registry.agencies.find(a => a.agency_id === 'sfpd')).toBeTruthy();
  });
});

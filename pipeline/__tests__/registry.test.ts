import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanTitle, stateFromTitle, guessOrgType, slugify, mergeDiscovered, mergeAgencies, loadRegistry, saveRegistry, type Registry, type RegistryAgency } from '../registry.js';

const skydio = (id: string, orgs: { org_uuid: string; dashboard_item_id: string; title: string }[], status: RegistryAgency['status'] = 'ok'): RegistryAgency => ({
  agency_id: id, display_name: id, state: null, org_type: 'law_enforcement', timezone: 'UTC', source: 'skydio_arcgis',
  source_config: { orgs, vanity_slug: null }, official_url: 'https://example.com', status,
  first_flight: null, last_flight: null, flight_count: 0, total_hours: 0, last_pulled_utc: null, notes: null,
});

describe('title helpers', () => {
  it('cleans Skydio dashboard titles', () => {
    expect(cleanTitle('Milwaukee Police Department Drone Flights')).toBe('Milwaukee Police Department');
    expect(cleanTitle(' Brookhaven Police Department - Skydio ')).toBe('Brookhaven Police Department');
    expect(cleanTitle('Virginia Beach Police Department DFR Flights')).toBe('Virginia Beach Police Department');
    expect(cleanTitle('Denver Police Department Drone as First Responder Flights')).toBe('Denver Police Department');
    expect(cleanTitle('Cleveland Division of Police ')).toBe('Cleveland Division of Police');
    expect(cleanTitle('Dearborn Police Department (MI) Drone Flights')).toBe('Dearborn Police Department');
    expect(cleanTitle('Concord Police Department (CA) Drone Flights')).toBe('Concord Police Department');
  });
  it('extracts a state hint', () => {
    expect(stateFromTitle('Dearborn Police Department (MI) Drone Flights')).toBe('MI');
    expect(stateFromTitle('Tampa Police Department Drone Flights')).toBeNull();
  });
  it('guesses org type', () => {
    expect(guessOrgType('Tulsa Fire Department')).toBe('fire_ems');
    expect(guessOrgType('Calcasieu Parish Sheriff\'s Office')).toBe('law_enforcement');
    expect(guessOrgType('University of Illinois Division of Public Safety')).toBe('university');
    expect(guessOrgType('Tennessee Department of Transportation (TDOT)')).toBe('government_other');
    expect(guessOrgType('Axon Air PSM')).toBe('vendor_partner');
    expect(guessOrgType('Duquesne Light Company')).toBe('corporate_utility');
  });
  it('slugifies with abbreviations and uniqueness', () => {
    const taken = new Set<string>();
    expect(slugify('Milwaukee Police Department', taken)).toBe('milwaukee-pd');
    expect(slugify("Calcasieu Parish Sheriff's Office", taken)).toBe('calcasieu-parish-so');
    expect(slugify('Milwaukee Police Department', taken)).toBe('milwaukee-pd-2');
    expect(slugify('St. Paul Police Department (MN)', taken)).toBe('st-paul-pd-mn');
  });
});

describe('mergeDiscovered', () => {
  const base = (): Registry => ({ agencies: [skydio('a-pd', [{ org_uuid: 'u1', dashboard_item_id: 'd1', title: 'A PD Drone Flights' }])] });
  it('adds unknown orgs as needs_review and skips known and excluded', () => {
    const reg = base();
    const res = mergeDiscovered(reg, [
      { item_id: 'd1', title: 'A PD Drone Flights', org_uuid: 'u1', modified: '2026-01-01T00:00:00.000Z' },
      { item_id: 'd2', title: 'New Town Police Department (TX) Drone Flights', org_uuid: 'u2', modified: '2026-01-01T00:00:00.000Z' },
      { item_id: 'd3', title: 'INT - Someone Drone Flights', org_uuid: 'u3', modified: '2026-01-01T00:00:00.000Z' },
      { item_id: 'd4', title: 'Mystery', org_uuid: null, modified: '2026-01-01T00:00:00.000Z' },
    ], [{ dashboard_item_id: 'd3', org_uuid: 'u3', title: 'INT - Someone Drone Flights', reason: 'skydio internal' }]);
    expect(res.added).toEqual(['new-town-pd-tx']);
    expect(res.unresolved.map(u => u.item_id)).toEqual(['d4']);
    const added = reg.agencies.find(a => a.agency_id === 'new-town-pd-tx')!;
    expect(added.status).toBe('needs_review');
    expect(added.state).toBe('TX');
    expect(added.display_name).toBe('New Town Police Department');
    expect(added.official_url).toBe('https://www.arcgis.com/apps/dashboards/d2');
    expect(reg.agencies.length).toBe(2);
  });
  it('retires an agency whose dashboards all vanished, and never deletes', () => {
    const reg = base();
    const res = mergeDiscovered(reg, [], []);
    expect(res.retired).toEqual(['a-pd']);
    expect(reg.agencies[0].status).toBe('retired');
    expect(reg.agencies.length).toBe(1);
  });
  it('does not touch curated fields of known agencies', () => {
    const reg = base();
    reg.agencies[0].display_name = 'Curated Name';
    mergeDiscovered(reg, [{ item_id: 'd1', title: 'Changed Title Drone Flights', org_uuid: 'u1', modified: '2026-01-01T00:00:00.000Z' }], []);
    expect(reg.agencies[0].display_name).toBe('Curated Name');
    expect(reg.agencies[0].status).toBe('ok');
  });
});

describe('mergeAgencies', () => {
  it('moves orgs into the kept agency and removes the absorbed one', () => {
    const reg: Registry = { agencies: [skydio('okc-pd', [{ org_uuid: 'u1', dashboard_item_id: 'd1', title: 'OKC' }]), skydio('okc-pd-docked', [{ org_uuid: 'u2', dashboard_item_id: 'd2', title: 'OKC Docked' }])] };
    mergeAgencies(reg, 'okc-pd', 'okc-pd-docked');
    expect(reg.agencies.length).toBe(1);
    expect((reg.agencies[0].source_config as any).orgs.map((o: any) => o.org_uuid)).toEqual(['u1', 'u2']);
  });
});

describe('load/save', () => {
  it('writes sorted, indented JSON with trailing newline', () => {
    const dir = mkdtempSync(join(tmpdir(), 'reg-'));
    const p = join(dir, 'registry.json');
    saveRegistry(p, { agencies: [skydio('zeta-pd', []), skydio('alpha-pd', [])] });
    const text = readFileSync(p, 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(text.indexOf('alpha-pd')).toBeLessThan(text.indexOf('zeta-pd'));
    expect(loadRegistry(p).agencies.map(a => a.agency_id)).toEqual(['alpha-pd', 'zeta-pd']);
  });
});

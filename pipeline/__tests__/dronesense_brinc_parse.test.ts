import { describe, it, expect } from 'vitest';
import { slim as dsSlim, toRecord as dsRecord } from '../dronesense/parse.js';
import { slim as brSlim, toRecord as brRecord } from '../brinc/parse.js';
import { validateRecord } from '../schema.js';

describe('DroneSense slim', () => {
  const raw = {
    id: '08df0a6d-762b-44f6-8f13-4de462638014',
    startDate: '2026-09-04T09:59:37Z',
    endDate: '2026-09-04T10:15:32Z',
    address: '1300 N Center St',
    description: 'Emergency disturbance involving road rage.',
    name: '2026-02470103',
    priority: 'P0',
    flightType: 'DFR',
    type: 'Disturbance',
    organizationId: '08dbfda3-799c-47d5-8ea4-82fd8e88191a',
    image: '/9j/4AAQSkZJRgABAQAAAQABAAD',
    imageUrl: 'https://example.invalid/scene.jpg',
  };

  it('never carries the inline map of the flight path', () => {
    const serialized = JSON.stringify(dsSlim(raw));
    expect(serialized).not.toContain('9j/4AAQ');
    expect(serialized).not.toContain('scene.jpg');
  });

  it('keeps what a flight log needs', () => {
    const f = dsSlim(raw);
    expect(f.id).toBe('08df0a6d-762b-44f6-8f13-4de462638014');
    expect(f.name).toBe('2026-02470103');
    expect(f.address).toBe('1300 N Center St');
  });

  it('treats an empty string as absent', () => {
    expect(dsSlim({ ...raw, address: '   ' }).address).toBeNull();
  });
});

describe('DroneSense toRecord', () => {
  const f = {
    id: 'abc', startDate: '2026-09-04T09:59:37Z', endDate: '2026-09-04T10:15:32Z',
    address: '1300 N Center St', description: 'Emergency disturbance involving road rage.',
    name: '2026-02470103', priority: 'P0', flightType: 'DFR', type: 'Disturbance',
  };

  it('maps a flight to a valid record', () => {
    const r = dsRecord('arlington-pd-tx-ds', 'America/Chicago', f)!;
    expect(validateRecord(r)).toEqual([]);
    expect(r.case_number).toBe('2026-02470103');
    expect(r.description).toBe('1300 N Center St');
    expect(r.extra.priority).toBe('P0');
  });

  it('takes the duration from the two timestamps', () => {
    expect(dsRecord('a', 'UTC', f)!.duration_min).toBe(15.9);
  });

  it('prefers the category over the free-text description', () => {
    expect(dsRecord('a', 'UTC', f)!.purpose).toBe('Disturbance');
    expect(dsRecord('a', 'UTC', { ...f, type: null })!.purpose).toBe('Emergency disturbance involving road rage.');
  });

  it('dates the flight locally rather than in UTC', () => {
    const late = { ...f, startDate: '2026-09-05T02:30:00Z', endDate: '2026-09-05T02:40:00Z' };
    expect(dsRecord('a', 'America/Chicago', late)!.flight_date_local).toBe('2026-09-04');
  });

  it('drops a flight with no id', () => {
    expect(dsRecord('a', 'UTC', { ...f, id: null })).toBeNull();
  });
});

describe('BRINC slim', () => {
  const raw = {
    flight_id: 'dd9b3161-2693-4309-8405-349ad9e67ad9',
    flight_time: 418.019,
    start_time: '2026-08-29T20:56:19.000Z',
    gps_url: 'https://liveops-drone-map-prod.s3.us-west-2.amazonaws.com/dd9b-telemetry-data.json?X-Amz-Signature=abc',
    missions: { '128785': { call_type: 'DOMDST – Domestic Disturbance', start_time: '2026-08-29T20:56:19.000Z', case_id: 'CPD26-62761' } },
  };

  it('never carries the telemetry link', () => {
    const serialized = JSON.stringify(brSlim(raw));
    expect(serialized).not.toContain('telemetry');
    expect(serialized).not.toContain('X-Amz-Signature');
  });

  it('keeps the calls a flight answered', () => {
    const f = brSlim(raw);
    expect(Object.values(f.missions ?? {})).toHaveLength(1);
    expect(Object.values(f.missions ?? {})[0].case_id).toBe('CPD26-62761');
  });

  it('survives a flight with no missions', () => {
    expect(brSlim({ ...raw, missions: null }).missions).toEqual({});
  });
});

describe('BRINC toRecord', () => {
  const f = brSlim({
    flight_id: 'f1', flight_time: 418.019, start_time: '2026-08-29T20:56:19.000Z',
    missions: { '1': { call_type: 'DOMDST – Domestic Disturbance', case_id: 'CPD26-62761' } },
  });

  it('maps a flight to a valid record', () => {
    const r = brRecord('clovis-pd-ca', 'America/Los_Angeles', f)!;
    expect(validateRecord(r)).toEqual([]);
    expect(r.purpose).toBe('DOMDST – Domestic Disturbance');
    expect(r.case_number).toBe('CPD26-62761');
  });

  it('converts the flight time from seconds to minutes', () => {
    expect(brRecord('a', 'UTC', f)!.duration_min).toBe(7);
  });

  it('counts a flight that answered several calls without doubling it', () => {
    const many = brSlim({
      flight_id: 'f2', flight_time: 600, start_time: '2026-08-29T20:56:19.000Z',
      missions: { '1': { call_type: 'Burglary', case_id: 'A-1' }, '2': { call_type: 'Foot Pursuit', case_id: 'A-2' } },
    });
    const r = brRecord('a', 'UTC', many)!;
    expect(r.purpose).toBe('Burglary');
    expect(r.extra.calls_for_service).toBe(2);
    expect(r.extra.other_call_types).toBe('Foot Pursuit');
  });

  it('keeps a flight that answered no call', () => {
    const none = brSlim({ flight_id: 'f3', flight_time: 120, start_time: '2026-08-29T20:56:19.000Z', missions: {} });
    const r = brRecord('a', 'UTC', none)!;
    expect(validateRecord(r)).toEqual([]);
    expect(r.purpose).toBeNull();
    expect(r.extra.calls_for_service).toBe(0);
  });

  it('drops a flight with no id', () => {
    expect(brRecord('a', 'UTC', { ...f, flight_id: null })).toBeNull();
  });
});

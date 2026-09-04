import { describe, it, expect } from 'vitest';
import { keepOnlyLabels, labelled } from '../selfpub/labels.js';
import { redactPeople, scrubText, minutesFromText, parseClock, keepRow, toRecord, type SelfPubSite } from '../selfpub/parse.js';
import { validateRecord } from '../schema.js';

const BLOOMINGTON_NOTES = [
  'Requested by: Training',
  'Reason: Training',
  'Pilot: Raisbeck',
  'Video Taken: No',
  'RMS Number: None',
  'Training flight. Gallion at controls',
].join('\n');

describe('keepOnlyLabels', () => {
  it('keeps only the labelled lines asked for', () => {
    expect(keepOnlyLabels(BLOOMINGTON_NOTES, ['Reason'])).toBe('Reason: Training');
  });

  it('drops prose that names someone with no label to match on', () => {
    const kept = keepOnlyLabels(BLOOMINGTON_NOTES, ['Reason', 'Video Taken']);
    expect(kept).not.toMatch(/Gallion/);
    expect(kept).not.toMatch(/Raisbeck/);
  });

  it('returns null when no line carries a wanted label', () => {
    expect(keepOnlyLabels('Training flight. Gallion at controls', ['Reason'])).toBeNull();
  });

  it('ignores anything that is not text', () => {
    expect(keepOnlyLabels(null, ['Reason'])).toBeNull();
    expect(keepOnlyLabels(42, ['Reason'])).toBeNull();
  });
});

describe('labelled', () => {
  it('reads the value after the label', () => {
    expect(labelled(BLOOMINGTON_NOTES, 'Reason')).toBe('Training');
  });

  it('treats a placeholder as absent', () => {
    expect(labelled('RMS Number: None', 'RMS Number')).toBeNull();
  });

  it('does not match a label that only appears mid-line', () => {
    expect(labelled('the reason: unclear', 'Reason')).toBeNull();
  });
});

describe('redactPeople', () => {
  it('drops a labelled name line and keeps the rest', () => {
    const out = redactPeople('Reason: Training\nPilot: Raisbeck\nVideo Taken: No');
    expect(out).toBe('Reason: Training\nVideo Taken: No');
  });

  it('redacts an identifier named mid-sentence, keeping the sentence', () => {
    const out = redactPeople('14 MINUTES flying tethered drone for a collision. Employee #6724');
    expect(out).toContain('14 MINUTES flying tethered drone for a collision.');
    expect(out).not.toContain('6724');
  });

  it('redacts a pilot number without eating the rest of the line', () => {
    const out = redactPeople('Official City business. Pilot #4820167 flew 12/06-12/07.');
    expect(out).toContain('Official City business.');
    expect(out).toContain('flew 12/06-12/07.');
    expect(out).not.toContain('4820167');
  });

  it('leaves text that names nobody alone', () => {
    expect(redactPeople('Fatality Vehicle Accident')).toBe('Fatality Vehicle Accident');
  });
});

describe('scrubText', () => {
  it('treats the literal text ArcGIS uses for empty as empty', () => {
    expect(scrubText('<Null>')).toBeNull();
    expect(scrubText('N/A')).toBeNull();
  });
});

describe('minutesFromText', () => {
  it('reads the forms these agencies write', () => {
    expect(minutesFromText('15 mins')).toBe(15);
    expect(minutesFromText('2 hours of training')).toBe(120);
    expect(minutesFromText('14 MINUTES flying tethered')).toBe(14);
    expect(minutesFromText('21 hours')).toBe(1260);
  });

  it('returns null when the text states no duration', () => {
    expect(minutesFromText('Official City business.')).toBeNull();
    expect(minutesFromText(null)).toBeNull();
  });
});

describe('parseClock', () => {
  it('reads twelve- and twenty-four-hour forms', () => {
    expect(parseClock('8:58 PM')).toEqual({ hour: 20, minute: 58 });
    expect(parseClock('12:05 AM')).toEqual({ hour: 0, minute: 5 });
    expect(parseClock('20:58')).toEqual({ hour: 20, minute: 58 });
  });

  it('rejects anything else', () => {
    expect(parseClock('sometime')).toBeNull();
    expect(parseClock('25:00')).toBeNull();
  });
});

describe('keepRow', () => {
  it('keeps only the rows a filter names', () => {
    const filter = { field: 'Department', values: ['Police'] };
    expect(keepRow({ Department: 'Yuma Police' }, filter)).toBe(true);
    expect(keepRow({ Department: 'Public Works' }, filter)).toBe(false);
    expect(keepRow({ Department: null }, filter)).toBe(false);
  });

  it('keeps everything when there is no filter', () => {
    expect(keepRow({ Department: 'Anything' }, undefined)).toBe(true);
  });
});

describe('toRecord', () => {
  const site: SelfPubSite = {
    agency_id: 'bloomington-pd-il',
    display_name: 'Bloomington Police Department',
    state: 'IL',
    timezone: 'America/Chicago',
    service_url: 'https://example.invalid/FeatureServer/0',
    official_url: 'https://example.invalid/FeatureServer/0',
    id_field: 'OBJECTID',
    fields: {
      date: 'Start_Date',
      time: 'Start_Time',
      duration_hours: 'Flight_Hours',
      purpose: 'Flight_Type',
      location: 'Location_Name',
      case_number: 'Call_For_Service',
      purpose_labelled: { field: 'Notes', label: 'Reason' },
      extra: { drone_model: 'Drone_Model' },
    },
  };

  const row = {
    OBJECTID: 1,
    Start_Date: Date.UTC(2025, 0, 5),
    Start_Time: '8:58 PM',
    Flight_Hours: 0.13,
    Flight_Type: null,
    Location_Name: '305 South East Street',
    Call_For_Service: '<Null>',
    Notes: 'Reason: Training',
    Drone_Model: 'Mavic 3 Thermal',
  };

  it('maps a row to a valid record', () => {
    const r = toRecord(site, row)!;
    expect(validateRecord(r)).toEqual([]);
    expect(r.flight_date_local).toBe('2025-01-05');
    expect(r.duration_min).toBe(7.8);
    expect(r.extra.drone_model).toBe('Mavic 3 Thermal');
  });

  it('reads the purpose out of the labelled line when the field is empty', () => {
    expect(toRecord(site, row)!.purpose).toBe('Training');
  });

  it('prefers the purpose field when it has a value', () => {
    expect(toRecord(site, { ...row, Flight_Type: 'Call for Service' })!.purpose).toBe('Call for Service');
  });

  it('treats the literal <Null> as no case number', () => {
    expect(toRecord(site, row)!.case_number).toBeNull();
  });

  it('pairs the date with the time in the agency timezone', () => {
    // 8:58 PM on 5 January in Chicago is 02:58 UTC the next day.
    expect(toRecord(site, row)!.takeoff_utc).toBe('2025-01-06T02:58:00.000Z');
  });

  it('keeps a row that publishes only a date', () => {
    const dateOnly: SelfPubSite = { ...site, fields: { date: 'Start_Date', purpose: 'Flight_Type' } };
    const r = toRecord(dateOnly, { OBJECTID: 9, Start_Date: Date.UTC(2026, 6, 30), Flight_Type: 'AGENCY ASSIST' })!;
    expect(validateRecord(r)).toEqual([]);
    expect(r.takeoff_utc).toBeNull();
    expect(r.flight_date_local).toBe('2026-07-30');
    expect(r.purpose).toBe('AGENCY ASSIST');
  });

  it('drops a row with no date, since it cannot be placed in time', () => {
    expect(toRecord(site, { ...row, Start_Date: null })).toBeNull();
  });

  it('never carries a field the mapping did not ask for', () => {
    const r = toRecord(site, { ...row, Pilot_Email: 'someone@example.gov', Takeoff_Latitude: 40.48 })!;
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain('example.gov');
    expect(serialized).not.toContain('40.48');
  });
});

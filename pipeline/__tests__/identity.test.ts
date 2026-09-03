import { describe, it, expect } from 'vitest';
import { placeKey, agencyKind, sameAgency, groupAgencies, type Candidate } from '../identity.js';

const c = (key: string, name: string, state: string | null = null): Candidate => ({ key, name, state });

describe('placeKey', () => {
  it('reduces the same department written several ways to one key', () => {
    expect(placeKey('ELK GROVE PD')).toBe('elk grove');
    expect(placeKey('Elk Grove Police Department')).toBe('elk grove');
    expect(placeKey('Elk Grove PD - Drone Program')).toBe('elk grove');
  });

  it('keeps county in the key, because a county agency is not the city one', () => {
    expect(placeKey('Hamilton County SO')).toBe('hamilton county');
    expect(placeKey('Hamilton Police Department')).toBe('hamilton');
  });

  it('handles an apostrophe in Sheriff’s Office', () => {
    expect(placeKey("Dutchess County Sheriff's Office UAS Unit")).toBe('dutchess county');
    expect(placeKey('Dutchess County Sheriffs Office')).toBe('dutchess county');
  });

  it('strips the dashboard chrome vendors add to titles', () => {
    expect(placeKey('AURORA PD FLIGHT DASHBOARD')).toBe('aurora');
    expect(placeKey('Denver Police Department DFR Flights')).toBe('denver');
  });
});

describe('agencyKind', () => {
  it('separates sheriffs from police', () => {
    expect(agencyKind('Hamilton County SO')).toBe('sheriff');
    expect(agencyKind('Hamilton Police Department')).toBe('police');
  });

  it('recognises the kinds that would otherwise look like police', () => {
    expect(agencyKind('Los Angeles Port Police')).toBe('port');
    expect(agencyKind('Georgia Tech PD')).toBe('university');
    expect(agencyKind('Sedona Fire District')).toBe('fire');
  });
});

describe('sameAgency', () => {
  it('matches one department across two platforms', () => {
    expect(sameAgency(c('a', 'ELK GROVE PD', 'CA'), c('b', 'Elk Grove PD', 'CA'))).toBe(true);
  });

  it('refuses a county sheriff and a city police department', () => {
    expect(sameAgency(c('a', 'Hamilton County SO', 'OH'), c('b', 'Hamilton Police Department', 'OH'))).toBe(false);
  });

  it('refuses a port police force and the city police department', () => {
    expect(sameAgency(c('a', 'Los Angeles Port Police', 'CA'), c('b', 'LOS ANGELES PD', 'CA'))).toBe(false);
  });

  it('refuses the same place name in two states', () => {
    expect(sameAgency(c('a', 'Everett Police', 'WA'), c('b', 'Everett Police', 'MA'))).toBe(false);
  });

  it('still matches when one source publishes no state', () => {
    expect(sameAgency(c('a', 'Denver Police Department', null), c('b', 'DENVER PD', 'CO'))).toBe(true);
  });

  it('refuses two entries with no place left after stripping', () => {
    expect(sameAgency(c('a', 'Police Department', null), c('b', 'Sheriff Office', null))).toBe(false);
  });
});

describe('groupAgencies', () => {
  it('gathers one agency published on three platforms', () => {
    const groups = groupAgencies([
      c('sky', 'Everett Police Department', 'WA'),
      c('flock', 'EVERETT PD', 'WA'),
      c('air', 'Everett Police', 'WA'),
      c('other', 'Aurora PD', 'CO'),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].map(g => g.key).sort()).toEqual(['air', 'flock', 'sky']);
  });

  it('joins a pair listed in the aliases that no rule would match', () => {
    const groups = groupAgencies(
      [c('sky', "Dutchess County Sheriff's Office UAS Unit"), c('flock', 'DUTCHESS SO', 'NY')],
      { link: [['sky', 'flock']], separate: [] },
    );
    expect(groups).toHaveLength(1);
  });

  it('keeps apart a pair the aliases mark as different agencies', () => {
    const groups = groupAgencies(
      [c('a', 'Springfield PD', 'IL'), c('b', 'Springfield PD', 'IL')],
      { link: [], separate: [['a', 'b']] },
    );
    expect(groups).toHaveLength(2);
  });

  it('merges two groups when a later entry bridges them', () => {
    const groups = groupAgencies(
      [c('a', 'Alpha PD', 'CA'), c('b', 'Beta PD', 'CA'), c('c', 'Alpha PD', 'CA')],
      { link: [['b', 'c']], separate: [] },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].map(g => g.key).sort()).toEqual(['a', 'b', 'c']);
  });

  it('leaves unrelated agencies alone', () => {
    expect(groupAgencies([c('a', 'Aurora PD', 'CO'), c('b', 'Mesa PD', 'AZ')])).toHaveLength(2);
  });
});

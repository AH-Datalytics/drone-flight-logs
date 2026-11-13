import { describe, it, expect } from 'vitest';
import { agreesWithState, stateForPoint } from '../places.js';

// Real points from data/agency_places.json, before and after correction.
const cobbCounty = { lat: 33.93739, lon: -84.5732 };
const cobbExtent = { lat: 34.07438, lon: -81.34464 };   // Skydio extent center, in South Carolina
const breckenridge = { lat: 39.48291, lon: -106.04655 };
const breckGeocoded = { lat: 38.4959, lon: -84.7355 };  // "breck, CO, USA" came back in Kentucky

describe('stateForPoint', () => {
  it('reads the state off a coordinate', () => {
    expect(stateForPoint(cobbCounty.lon, cobbCounty.lat)).toBe('GA');
    expect(stateForPoint(breckGeocoded.lon, breckGeocoded.lat)).toBe('KY');
  });

  it('is null for a point outside the country', () => {
    expect(stateForPoint(-30, 40)).toBeNull(); // mid-Atlantic
  });
});

describe('agreesWithState', () => {
  it('accepts a point inside the expected state', () => {
    expect(agreesWithState(cobbCounty, 'GA')).toBe(true);
    expect(agreesWithState(breckenridge, 'CO')).toBe(true);
  });

  it('rejects a same-named place in another state', () => {
    expect(agreesWithState(breckGeocoded, 'CO')).toBe(false);
    expect(agreesWithState(cobbExtent, 'GA')).toBe(false);
  });

  it('rejects a point outside every state when a state is expected', () => {
    expect(agreesWithState({ lat: 40, lon: -30 }, 'NY')).toBe(false);
  });

  it('has nothing to contradict when no state is expected', () => {
    expect(agreesWithState(breckGeocoded, null)).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { fmtInt, fmtHours, fmtDate, daysSince, fmtMinutes, fmtMonthLabel, planTicks } from '../format';
describe('format', () => {
  it('formats', () => {
    expect(fmtInt(120348)).toBe('120,348'); expect(fmtInt(null)).toBe('—');
    expect(fmtHours(980.14)).toBe('980'); expect(fmtHours(12.34)).toBe('12.3');
    expect(fmtDate('2026-08-23')).toBe('Aug 23, 2026');
    expect(daysSince('2026-08-23', new Date('2026-09-01T00:00:00Z'))).toBe(9);
    expect(fmtMinutes(13.46)).toBe('13'); expect(fmtMinutes(4.26)).toBe('4.3');
  });
});
describe('fmtMonthLabel', () => {
  it('shortens YYYY-MM to "Mon \'YY"', () => {
    expect(fmtMonthLabel('2025-03')).toBe("Mar '25");
    expect(fmtMonthLabel('2026-12')).toBe("Dec '26");
  });
  it('returns the input unchanged if it does not match', () => { expect(fmtMonthLabel('bogus')).toBe('bogus'); });
});
describe('planTicks', () => {
  it('shows every tick unangled when they all fit', () => {
    expect(planTicks(['Mon', 'Tue', 'Wed'], 400)).toEqual({ interval: 0, angle: 0 });
  });
  it('thins and angles ticks when the width is too narrow to fit them all', () => {
    const labels = Array.from({ length: 40 }, (_, i) => `Mar '${25 + i}`);
    const plan = planTicks(labels, 340);
    expect(plan.angle).toBe(-40);
    expect(plan.interval).toBeGreaterThan(0);
  });
  it('handles degenerate input', () => {
    expect(planTicks([], 400)).toEqual({ interval: 0, angle: 0 });
    expect(planTicks(['x'], 400)).toEqual({ interval: 0, angle: 0 });
    expect(planTicks(['a', 'b'], 0)).toEqual({ interval: 0, angle: 0 });
  });
});

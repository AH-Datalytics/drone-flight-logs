import { describe, it, expect } from 'vitest';
import { fmtInt, fmtHours, fmtDate, daysSince, fmtMinutes } from '../format';
describe('format', () => {
  it('formats', () => {
    expect(fmtInt(120348)).toBe('120,348'); expect(fmtInt(null)).toBe('—');
    expect(fmtHours(980.14)).toBe('980'); expect(fmtHours(12.34)).toBe('12.3');
    expect(fmtDate('2026-08-23')).toBe('Aug 23, 2026');
    expect(daysSince('2026-08-23', new Date('2026-09-01T00:00:00Z'))).toBe(9);
    expect(fmtMinutes(13.46)).toBe('13'); expect(fmtMinutes(4.26)).toBe('4.3');
  });
});

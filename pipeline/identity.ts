/**
 * Deciding when two published dashboards belong to the same agency.
 *
 * Fourteen agencies in the census publish on more than one platform, so this
 * has to be right in both directions. Missing a match splits one department
 * into two half-populated pages. Making a false one merges two real
 * departments, which is worse: Hamilton County Sheriff's Office and Hamilton
 * Police Department are different agencies in different places, and a loose
 * name match would have joined them.
 *
 * So a match needs three things to agree — the place, the kind of agency, and
 * the state — and anything short of that stays separate and gets reviewed by
 * hand.
 */

export type AgencyKind = 'police' | 'sheriff' | 'fire' | 'university' | 'port' | 'other';

const KIND_PATTERNS: [AgencyKind, RegExp][] = [
  // "Georgia Tech PD" names a campus force without using the word university.
  ['university', /\b(university|college|tech)\b/i],
  ['port', /\bport\b/i],
  ['sheriff', /\b(sheriff|sheriffs|so|scso|kcso|sherrif)\b/i],
  ['fire', /\b(fire|ems|rescue|emergency services)\b/i],
  ['police', /\b(police|pd|dps|public safety|constable|marshal)\b/i],
];

export function agencyKind(name: string): AgencyKind {
  for (const [kind, re] of KIND_PATTERNS) if (re.test(name)) return kind;
  return 'other';
}

const NOISE = [
  'police department', 'police dept', 'police dpt', 'department of police', 'police',
  "sheriff's office", 'sheriffs office', "sheriff's department", 'sheriff office', 'sheriff',
  'fire district', 'fire department', 'fire rescue', 'fire', 'emergency services',
  'public safety', 'department', 'dept', 'dpt', 'office', 'division', 'bureau',
  'drone as first responder', 'drone program', 'dfr', 'uas', 'suas', 'unit',
  'metropolitan', 'metro', 'city of', 'town of', 'village of', 'county of', 'the',
  'pd', 'so', 'dps', 'rtic', 'beta', 'flight dashboard', 'flights', 'flight',
];

/**
 * The place a dashboard is about, with the words every agency name shares
 * stripped out. "ELK GROVE PD" and "Elk Grove Police Department" both reduce
 * to "elk grove"; "Hamilton County SO" reduces to "hamilton county", which is
 * not "hamilton".
 */
export function placeKey(name: string): string {
  // Apostrophes go before other punctuation, so "Sheriff's Office" becomes
  // "sheriffs office" and matches the noise list, rather than splitting into
  // "sheriff s office" and leaving a stray "s" in the key.
  let s = ' ' + name.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
  for (const word of NOISE) s = s.split(' ' + word + ' ').join(' ');
  // A second pass: stripping one word can leave two others adjacent.
  for (const word of NOISE) s = s.split(' ' + word + ' ').join(' ');
  return s.replace(/\s+/g, ' ').trim();
}

export type Candidate = { key: string; name: string; state: string | null };

/**
 * Whether two dashboards are the same agency. Place and kind must agree
 * exactly. States must agree when both are known; an unknown state is not
 * treated as agreement on its own, but it does not block a match when
 * everything else lines up, because several sources publish no state at all.
 */
export function sameAgency(a: Candidate, b: Candidate): boolean {
  const pa = placeKey(a.name), pb = placeKey(b.name);
  if (!pa || !pb || pa !== pb) return false;
  if (agencyKind(a.name) !== agencyKind(b.name)) return false;
  if (a.state && b.state && a.state !== b.state) return false;
  return true;
}

/**
 * Pairs the rules cannot settle, decided by hand.
 *
 * `link` joins two source keys the rules leave apart — an agency whose
 * dashboards are titled differently enough that no safe rule would match them,
 * such as a sheriff's office that writes its county name on one platform and
 * drops it on another. `separate` forces two apart that the rules would join.
 * Both are keyed on the source entry's own id, never on a display name, so a
 * dashboard being retitled cannot silently change who gets merged.
 */
export type Aliases = { link: [string, string][]; separate: [string, string][] };

export const NO_ALIASES: Aliases = { link: [], separate: [] };

function pairHas(pairs: [string, string][], a: string, b: string): boolean {
  return pairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

/** Group source entries into agencies, keeping the order they arrived in. */
export function groupAgencies<T extends Candidate>(entries: T[], aliases: Aliases = NO_ALIASES): T[][] {
  const matches = (a: T, b: T): boolean => {
    if (pairHas(aliases.separate, a.key, b.key)) return false;
    if (pairHas(aliases.link, a.key, b.key)) return true;
    return sameAgency(a, b);
  };

  const groups: T[][] = [];
  for (const e of entries) {
    const hits = groups.filter(g => g.some(m => matches(m, e)));
    if (hits.length === 0) { groups.push([e]); continue; }
    // An entry can bridge two groups that had nothing linking them directly.
    hits[0].push(e);
    for (const extra of hits.slice(1)) {
      hits[0].push(...extra);
      groups.splice(groups.indexOf(extra), 1);
    }
  }
  return groups;
}

# Law Enforcement Drone Flight Log

What law-enforcement drone programs actually do, agency by agency: how often they fly, for how long, at what hours of which days, and for what stated reason.

There is no national register of police drone flights and no law requiring one. What exists is a scattering of vendor dashboards, each publishing a different subset of a different set of fields, with no index of who has one. This repository finds them, collects what they publish, merges the agencies that publish in more than one place, and serves the result as a site.

A project of [AH Datalytics](https://ahdatalytics.com).

## What is in the data

| Source | Agencies | Reported flights | Notes |
| --- | --- | --- | --- |
| Skydio transparency dashboards | 136 | 102,052 | Skydio aircraft only |
| Flock Aerodome community dashboards | 75 | 99,492 | Call type, case number, priority, block address |
| AirData public flight logs | 20 | 77,211 | No flight durations published |
| Motorola CAPE transparency portals | 9 | 8,746 | Most keep only the last 30–60 days |
| San Francisco open data | 1 | 7,481 | Whole fleet; date but no time of day |
| **Merged** | **226** | **294,652** | 13 agencies publish in more than one place |

182 agencies are shown on the site. The rest are collected but hidden, because a record of a few test flights describes a dashboard rather than a drone program.

Every figure counts **distinct flights**, never rows: several published services contain the same flight two or three times over.

## Running it

```bash
npm install
npm run dev            # the site at localhost:3000
npm test               # 239 tests
npm run build          # production build, ~190 static pages
```

## Collecting

```bash
npm run refresh        # every source, then merge, then the site's files
```

Or one source at a time:

```bash
npm run pull           # Skydio + San Francisco
npm run flock:collect  # Flock, via a real browser
npm run airdata:collect
npm run cape:collect
npm run build:data     # merge everything into data/site
npm run census:csv     # regenerate the source inventory
```

`overnight.bat` runs an unattended backfill: it holds the machine awake, retries a source that fails, resumes wherever it stopped, and merges when it finishes. `refresh.bat` is the monthly version, suitable for Task Scheduler.

**Two sources forget.** Flock shows about a month at a time and most Motorola portals keep thirty or sixty days, so their collectors only ever add: a flight that has aged out of the source stays here. A month that passes without a run is a month of those agencies lost for good. That is the reason for the schedule.

## Layout

```
pipeline/           collectors, identity matching, merge, build
  flock/ airdata/ cape/ adapters/     one directory per source
  identity.ts       when two dashboards are one agency
  merge.ts          when two records are one flight
  build.ts          merges everything into data/site
app/ components/ lib/                 the site
data/
  registry.json     Skydio and San Francisco agencies
  *_sites.json      the other sources' dashboards
  site/             the merged view the site reads — the committed record
  raw/              raw vendor payloads (git-ignored, rebuildable)
research/census/    how each source was found, and what has not been found yet
docs/superpowers/   the spec and the plans
```

## What is deliberately not collected

No flight paths. Several sources publish the full track of every flight; it is discarded at parse time, before anything is written to disk. No pilot names, aircraft serial numbers or dock identifiers, even where a source exposes them. Where an agency publishes a place for a flight, that text is kept as the agency wrote it — a block-level address or an intersection, never a coordinate.

## Attribution

Agency locations for the map were geocoded through OpenStreetMap's Nominatim service, so map data is © OpenStreetMap contributors, available under the [Open Database License](https://www.openstreetmap.org/copyright). State outlines come from the US Census Bureau via [us-atlas](https://github.com/topojson/us-atlas).

The favicon is [drone case icons created by Magnific – Flaticon](https://www.flaticon.com/free-icons/drone-case), used under Flaticon's free license, which requires that attribution. It appears in the site's footer.

The flight records themselves are published by the agencies named alongside them; each agency page links to that agency's own dashboard, which is the authoritative source.

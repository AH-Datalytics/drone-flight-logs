# Police Drone Flight Log Explorer — Design

**Date:** 2026-09-01
**Status:** Draft for review
**Working project name:** `police-drone-logs` (rename freely; nothing depends on it yet)

## 1. What this is

A public website where anyone can pick a police agency and see the drone flights it has published: how often it flies, for how long, when, and for what stated reason, with a searchable table of individual flights and a link to the agency's own official flight map.

It aggregates every agency that publishes flight-level drone logs in machine-readable form, from whatever source the agency uses. The first source is Skydio's public transparency dashboards (139 agencies, ~120,000 flights). The second is the San Francisco Police Department's dataset on the city's open data portal (~7,500 flights). Further sources are added as adapters after a separate research pass.

The data is pulled weekly and stored in this repository, so the site owns its data, keeps a history of what each agency published, and does not depend on vendor services being up when a reader visits.

## 2. What this is not

- **Not a map.** Flight-path geometry is not stored. Every agency page links to the agency's official map instead. This keeps the weekly pull to tens of megabytes instead of gigabytes.
- **Not a national trend story.** Aggregate flight counts across agencies mostly reflect when each agency started publishing, not how much drones are flown. The site does not show a national total or a national time series. Cross-agency comparison is limited to the landing table.
- **Not a purpose taxonomy.** Each agency's stated flight purposes are shown in the agency's own words. No cross-agency normalization is applied on the site. (The crosswalk built during research is kept as a reference file, not used in the product.)
- **Not live.** Data is as of the last weekly pull, and every page says so.

## 3. Audience and success

Readers are journalists, researchers, local-government staff, and residents who want to know what a specific agency is doing with drones. Success looks like: a reader types "Milwaukee," lands on Milwaukee's page in one click, and within a minute understands how often MPD flies, when, for how long, and why, and can click through to the official map and find a specific flight by case number.

## 4. Data model

### 4.1 Common flight record

Every source adapter produces records in this one shape. Fields marked optional may be null when the source does not provide them; the UI hides the corresponding view when a field is null for an entire agency.

| Field | Type | Notes |
|---|---|---|
| `agency_id` | string | Stable slug, see §4.3 |
| `source_flight_id` | string | Source's own identifier; unique within agency |
| `takeoff_utc` | ISO datetime or null | Null when source gives a date only (SFPD) or the source record has no timestamp |
| `flight_date_local` | `YYYY-MM-DD` or null | Derived from `takeoff_utc` in the agency timezone, or taken directly from a date-only source. Null only when the source record has no date at all |
| `landing_utc` | ISO datetime or null | |
| `duration_min` | number or null | Landing minus takeoff, or source's own duration field |
| `purpose` | string or null | Agency's stated reason, verbatim |
| `description` | string or null | Free text, verbatim |
| `case_number` | string or null | CAD / item / event number, verbatim |
| `extra` | object | Source-specific fields worth keeping (e.g. SFPD `analysis_neighborhood`, `supervisor_district`). Displayed as additional table columns when present |
| `data_quality` | string or null | Null when clean. Otherwise a short code such as `missing_takeoff` or `missing_landing`, so flawed records stay visible instead of being dropped |

Excluded deliberately: geometry, pilot identity, vehicle and dock serials. Skydio's public services already null the identity fields; the adapter drops them regardless so a future change on Skydio's side cannot leak them onto this site.

### 4.2 Agency registry

One record per agency, maintained in `data/registry.json`. Partly hand-curated, partly refreshed by the pipeline.

| Field | Source | Notes |
|---|---|---|
| `agency_id` | curated | slug |
| `display_name` | curated | e.g. "Milwaukee Police Department" |
| `state` | curated | two-letter, may be null for non-US (Medicine Hat, Australian Federal Police) |
| `org_type` | curated | `law_enforcement`, `fire_ems`, `university`, `government_other`, `corporate_utility`, `vendor_partner` |
| `timezone` | curated, seeded automatically | IANA zone, see §4.4 |
| `source` | curated | `skydio_arcgis` or `sfpd_datasf` (more later) |
| `source_config` | curated | Adapter-specific: Skydio org UUID and ArcGIS dashboard item id; SFPD dataset id |
| `official_url` | curated | The agency's own public flight map or portal, used for the "View official map" link. For Skydio agencies with a live vanity page, `https://cloud.skydio.com/dashboard/<slug>`; otherwise the ArcGIS dashboard URL |
| `status` | pipeline | `ok`, `stale` (no new flights in 60+ days), `unreachable` (last pull failed), `retired` (removed from source), `needs_review` (auto-discovered, curated fields not yet filled; not shown on the site) |
| `first_flight`, `last_flight`, `flight_count`, `total_hours`, `last_pulled_utc` | pipeline | Summary stats for the landing table |
| `notes` | curated | Free text shown on the agency page, e.g. "Mixed fleet; this log covers all vendors" for SFPD, or "Two Skydio orgs merged" for Oklahoma City |

The pipeline may **add** Skydio agencies it discovers (with `display_name` copied from the dashboard title and `status: needs_review`), but never edits curated fields and never deletes. A human promotes a discovered agency by filling in the curated fields.

### 4.3 Agency identity rules

- `agency_id` is a hand-assigned slug (`milwaukee-pd`, `sfpd`, `calcasieu-parish-so`). It never changes once published, because it is the URL.
- Where one agency has two Skydio orgs or dashboards (Oklahoma City has a "Docked" and a general dashboard; Brooklyn Park has a dock-trial org and a main org), they are **one agency** in the registry with two entries in `source_config`. The adapter merges them and de-duplicates on `source_flight_id`.
- Skydio-internal orgs (names beginning `INT -`, `lNT`, `[Paraverse]`, `[TEMPLATE]`, `DFR Summit`, employee names, `Synthetic`, `Vincent`, `Dev Test`, `Axon Demo Sim`) are listed in `data/excluded_orgs.json` with a reason and are never ingested.
- Corporate, utility and vendor orgs (AEP, Duquesne Light, Turner Construction, Axon, etc.) **are** ingested, typed `corporate_utility` or `vendor_partner`, and the landing table defaults to showing public-safety types only with a toggle to show all.

### 4.4 Timezone

Charts by hour of day need each agency's local time. No per-flight geometry is stored, so the timezone is a registry field.

- Seeded automatically for Skydio agencies from the ArcGIS layer's `extent` (the layer metadata includes a bounding box; its center longitude and latitude map to a US timezone, non-US handled by hand).
- Set by hand for anything else.
- Recorded in the registry so a wrong seed is a one-line fix, not a code change.

SFPD publishes dates without times, so its `takeoff_utc` is null and its page has no hour-of-day chart.

## 5. Sources and adapters

Each adapter is a small module with one job: fetch from its source and emit common flight records for one agency. Adapters share nothing but the output shape and a common HTTP helper with retries and exponential backoff.

### 5.1 `skydio_arcgis`

**Discovery.** Skydio publishes every transparency dashboard as a public ArcGIS item owned by ArcGIS org `mnhQTdIYDA7UoY2l` (account `bella_skydio_inc`). A search of that org for `type:Dashboard` returns the full list (219 at time of writing). Each dashboard's data references a web map whose title is `<skydio-org-uuid>-production-web-map`, and each org's flights live at:

```
https://services7.arcgis.com/mnhQTdIYDA7UoY2l/arcgis/rest/services/<skydio-org-uuid>-production/FeatureServer/0
```

The vanity page slug (`cloud.skydio.com/dashboard/<slug>`) is **not** discoverable from ArcGIS. It resolves via a GraphQL query to `https://api.skydio.com/graphql` with header `transparency-dashboard-path: <slug>` (401 when the slug does not exist). Known slugs are stored in the registry; the pipeline does not brute-force new ones.

**Pull.** Query the feature layer with `returnGeometry=false`, `outFields=*`, ordered by `takeoff, ObjectId`, paginated at 1,000 with `resultOffset`. Fields used: `flight_id`, `takeoff` (epoch ms), `landing` (epoch ms), `external_id` → `case_number`, `description`, `flight_purpose` → `purpose`. Rows with null `takeoff` are kept, with `flight_date_local` null and a `data_quality` note, since they are real published records (about 0.1%).

**Per-agency full re-pull each week, not incremental.** Agencies edit and un-publish flights; a diff against `ObjectId` would miss deletions. Attribute-only pulls are cheap enough (about two minutes for all agencies) that correctness wins.

### 5.2 `sfpd_datasf`

Socrata dataset `giw5-ttjs` on `data.sfgov.org`. Fields: `date` (date only), `flight_duration_minutes`, `reason_for_flight` → `purpose`, `call_type_original_desc` → `description`, `case_cad_event_number` → `case_number`, plus `analysis_neighborhood` and `supervisor_district` into `extra`. `source_flight_id` is the Socrata row id (`:id`). Paginated with `$limit`/`$offset`, full re-pull weekly. Official link: SFPD's drones page and the DataSF map.

Note for the agency page: SFPD's log covers its whole fleet (DJI, Skydio, Flock Safety and others), whereas Skydio-sourced agencies show Skydio flights only. This is the single most important caveat on the site and is written into SFPD's registry `notes`.

### 5.3 Future sources

Added only after a research pass produces an inventory of agencies publishing flight-level, machine-readable logs outside Skydio. Candidates to check: Chula Vista PD, Flock Safety / Aerodome customer transparency pages, Brinc, Axon. Sources that publish only aggregate counts or PDF annual reports (e.g. California AB 481 reports) are out of scope.

## 6. Pipeline

A single command, `npm run pull`, run by a GitHub Actions workflow on a weekly schedule (Monday 06:00 UTC) and manually on demand.

1. **Discover.** Re-scan the Skydio ArcGIS org. Any dashboard not in the registry or exclusion list is appended to the registry with `status: needs_review`. Any registry agency whose dashboard has disappeared gets `status: retired` (data retained).
2. **Pull.** For each active agency, run its adapter. Concurrency 6. Per-agency failure after retries is logged, the agency's `status` becomes `unreachable`, and **its previous data file is kept unchanged.** One bad agency never blocks the run.
3. **Write.** One file per agency at `data/flights/<agency_id>.json`, as a header row plus array-of-arrays (compact, diff-friendly, gzips to roughly 1/8). Registry summary fields recomputed. A `data/manifest.json` records run time, per-agency row counts and statuses.
4. **Validate.** Every record checked against the schema; a file with zero rows when the previous had rows is treated as a failure and the previous file kept.
5. **Commit and push.** Only if something changed. Vercel is git-connected, so the push is the deploy.

**Repository size.** All agencies attribute-only is roughly 20 MB uncompressed today. Weekly changes are mostly appended rows, which git delta-compresses well. Estimated growth well under 100 MB per year. If that proves wrong, the fallback is moving `data/` to Vercel Blob with the same file layout, which is a pipeline change, not a site change.

**Cost.** One run of a few minutes per week is about 4 billed Actions minutes per month.

## 7. Site

Next.js (App Router) on Vercel under the `ahdatalytics` scope, statically generated at build time from `data/`. Recharts for charts. No database, no API routes, and nothing fetched from outside the site at runtime.

Page shells, stat rows and charts are prerendered from aggregates computed at build time. The flight table is the one large payload: the agency's compact flight file is copied to a static asset and loaded by the browser on the agency page, so Cincinnati's ~30,000 rows (about 3 MB, under 500 KB gzipped) arrive only when someone opens Cincinnati.

### 7.1 Landing page

- Search box (agency name, city, state) that filters the table as you type.
- Table of agencies: name, state, type, flights, hours, first and last flight, days since last flight, status badge. Sortable. Defaults to public-safety types; toggle for all.
- A short paragraph explaining what the site is and the two big caveats: agencies choose what to publish, and Skydio-sourced agencies show Skydio flights only.
- "Data as of <date>" line.

### 7.2 Agency page `/agency/<agency_id>`

Top: agency name, state, source, official-map button, status badge, data-as-of line, registry `notes` if any.

Stat row: total flights, total hours, median flight length, flights in last 30 days, days since last flight, share of flights with a case number.

Charts, each hidden if the underlying field is null for the whole agency:
- Flights per month (bar).
- Flights by weekday and by hour of day (two small bars; hour chart only when takeoff time exists).
- Flight duration distribution (histogram, 5-minute bins, capped at 60+).
- Stated purpose: horizontal bar of the agency's own labels, top 15, with a count of "other". Blank shown as "Not stated".

Flight table: date, local time, duration, purpose, case number, description, plus any `extra` columns. Text search across all columns, sort by any column, paginated at 50. A "Download CSV" button linking to a per-agency CSV generated at build time as a static file, so no server code is involved.

### 7.3 Data notes page `/about`

Where the data comes from, exactly what is and is not included, the pull schedule, the identity rules in §4.3, and how to report an error. Links to the exploratory research files are not published.

### 7.4 Design

Technological, clean and modern — a precision instrument rather than a newspaper page. Hairline 1px grid, squared corners, monospace for every number and identifier, one cool accent against near-neutral surfaces, generous negative space, and a real dark mode driven by `prefers-color-scheme`. Dense and data-first, but not editorial pastiche. No portal bar, no gradients, no shadows, no rounded corners, no emoji. Charts follow the house rules: y-axis from zero, round intervals, no decimals.

## 8. Error handling and quality

- Adapter failures are per-agency, never fatal; surfaced as `unreachable` on the site.
- Records with null takeoff are kept and flagged, not dropped.
- Zero-row pulls are rejected in favor of the previous file.
- Every page states the pull date. `stale` status is computed, not asserted, so an agency that quietly stops publishing shows it within a week.
- The manifest is committed with the data, so any week's site can be reconstructed from git.

## 9. Testing

- **Adapters:** unit tests against saved fixture responses (one page of Milwaukee, one page of SFPD, a null-takeoff row, an empty page). Assert the emitted records match the schema and expected values.
- **Merge and de-dup:** test that two `source_config` entries for one agency merge without duplicates.
- **Pipeline safety:** test that an adapter throwing leaves the previous data file byte-identical and sets `unreachable`; test that a zero-row result is rejected.
- **Schema:** every committed `data/flights/*.json` validated in CI on each push.
- **Site:** build succeeds against the committed data; a Playwright smoke test loads the landing page, searches "Milwaukee," opens the agency page, and confirms the official-map link points at the registry URL. Verified in the browser before any production deploy, per house rule.

## 10. Open items

1. **Project and domain name.** `police-drone-logs` is a placeholder.
2. **Research pass for additional sources** (§5.3) — a separate bounded task, run after the site exists with two sources.
3. **Whether to seed the site with the 2026-09-01 pull already on disk** or take the first pull fresh from the pipeline. Recommendation: fresh, so day one is produced by the same code that runs weekly.

## 11. Reference: what the research established

Kept here so the adapter author does not rediscover it.

- Skydio transparency dashboards are ArcGIS items in org `mnhQTdIYDA7UoY2l`, all `access: public`, 219 total on 2026-09-01, of which about 50 are Skydio-internal or demo orgs and 139 are external organizations with flight data.
- The public feature services expose `user_email`, `vehicle_serial`, `dock_serial`, `operation_id` fields but every value is null across all 120k rows checked.
- Feature service `maxRecordCount` is 2,000. **Pagination must be count-verified.** Fetch `returnCountOnly=true` first, page until the collected total reaches it or a page returns ZERO features, and fail loudly if the final count does not match. A short mid-stream page is legal — ArcGIS returns fewer rows than requested when it hits an internal time limit — so treating a short page as end-of-data silently truncates. This was not theoretical: it cut Cincinnati from 30,071 rows to 17,938 on the first live run, with no error anywhere.
- About 0.1% of rows have a null/epoch-zero `takeoff`; about 0.4% have no geometry (irrelevant once geometry is dropped).
- Vanity-page lookup: `POST https://api.skydio.com/graphql` with header `transparency-dashboard-path`; query `transparencyDashboardSettings { enabled vanityUrlPath dashboardUrl title organizationId }`. 24 slugs known; 6 of those have `enabled: false` while their ArcGIS dashboard remains public.
- SFPD: 7,481 rows, 2024-05-16 to 2026-06-30 as of 2026-09-01; `reason_for_flight` was consolidated to a controlled list on 2025-09-01, earlier rows are free text.

# Source Census and V1 Completion — Design

**Date:** 2026-09-02
**Status:** Approved direction from Jeff: "suggest a research plan for identifying as many live sites as possible, then pull the data using Opus and apply everything to building a completed V1 site."
**Executes on:** Opus, working directly on main (no subagents — standing preference).
**Supersedes:** §5.3 of the original design spec (future sources), which this replaces with a concrete program.

## 0. What today's research established (evidence, not theory)

Five publishing channels exist. Each has a different enumeration property, a different access mechanism, and a different data-retention shape. **No single technique enumerates them all, and every guess-based count is a floor.**

| Channel | Known | Enumeration | Access | Retention |
|---|---|---|---|---|
| Skydio (ArcGIS) | 136 — **complete count** | Vendor's own index (ArcGIS org search) | Public map API, count-verified pagination | Full history |
| AirData (`app.airdata.com/u/<slug>`) | 10 — floor | Crawl indexes + slug guesses | Plain server-rendered HTML, **6 records/page**, `?month=MYYYY&pageno=N` | Full history (CVPD back to Apr 2021) |
| Motorola CAPE (`aerial.motorolasolutions.com/transparency/<slug>`) | 8 — floor | Crawl indexes + slug guesses; clean existence oracle (`api/project-settings`) | **Public JSON API**, `api/flights-list` with `page_size=10000` | **Rolling window** (30/60 days, sometimes unlimited) |
| Flock Aerodome (`community.<municipal-domain>.aerodome.com`) | 87 provisioned — **upper bound** | **Certificate Transparency** (subdomain-per-agency) | Cloudflare bot challenge; renders in a real browser | Unknown |
| Self-published (city portals) | 1 (SFPD/Socrata) + ~6 named in press | Open-data catalog APIs + news + municipal sites | Varies; Socrata/ArcGIS Hub have real APIs | Varies |
| DJI | none | n/a | No public portal product exists | n/a |

Hard-won corrections that the plan must encode:

- **Provisioned ≠ published.** `community.san-francisco.ca.us.aerodome.com` has a certificate and returns nothing. CT output requires a liveness pass.
- **A count from one vendor can be wrong by two orders of magnitude.** Las Vegas Metro: 3 flights on its Skydio dashboard (one day, May 2026); 72+ in a single month on AirData.
- **Agencies multi-publish routinely.** Elk Grove: AirData + Flock. Everett: Skydio + AirData + a Flock hostname. Hemet: Motorola + a Flock hostname. Brookhaven: Skydio + Motorola. This creates a **double-counting risk** the moment two sources are merged for one agency.
- **Rolling windows change storage semantics.** A 30-day CAPE window means data not collected within 30 days is gone forever. "Full re-pull, source is truth" — the pipeline's current rule — would *delete* history for these agencies. CAPE requires accumulate semantics.
- **Slug patterns are per-vendor and inconsistent** (`cvpd`, `brookhavenga`, `breapd-ca`). Guessing finds things but can never bound the answer; correcting one pattern immediately found Amherst OH.

## 1. Phase A — Enumerate (cheap, zero-load, mostly parallel)

Order matters: authoritative and third-party indexes first, guessing last and only to convert known names into slugs.

**A1. Certificate Transparency, run wide.** Query `crt.sh/json?q=<domain>` for every candidate vendor domain, not just `aerodome.com`: `airdata.com`, `motorolasolutions.com` (grep for `aerial.`/`transparency`), `dronesense.com`, `paladindrones.com` / `paladin.ai`, `brinc.com` / `brincdrones.com`, `axon.com` (Axon Air), `fusus.com`, `skydio.com`. Purpose: (a) confirm no other vendor uses subdomain-per-agency, (b) **discover platforms we do not know exist**. CT results are upper bounds of provisioned hostnames.

**A2. Crawl indexes for the path-based platforms.** For each of `app.airdata.com/u/*`, `aerial.motorolasolutions.com/transparency/*`, and `*.aerodome.com/*`:
- Common Crawl: iterate **all indexes from 2021 forward** (not just the latest three — agencies that stopped publishing still count as sites to record; and Common Crawl found Sacramento when 3,414 guesses missed it).
- Wayback CDX (`web.archive.org/cdx/search/cdx?url=...&collapse=urlkey`) — it found Brea/Hemet/Yonkers when the sweep missed them.
Extract slugs, dedupe, feed to Phase B.

**A3. Open-data catalog APIs for self-publishers.** This channel is enumerable and nobody has done it:
- Socrata discovery API (`api.us.socrata.com/api/catalog/v1`) with queries: `drone flight`, `UAS flight`, `sUAS deployment`, `drone as first responder`, `unmanned aircraft`.
- ArcGIS Hub search (`hub.arcgis.com/api/v3/datasets?q=...`) with the same terms — Cleveland's own hub dashboard came from this world.
- data.gov (CKAN API), same terms.
Keep only flight-level datasets (a row per flight); aggregate annual-report datasets are out of scope per the original spec.

**A4. Names harvest.** Vendor press/case-study pages (Skydio, AirData, Motorola, Flock), drone trade press (DroneLife, DroneDJ, dronexl, police1, sUAS News), and news queries per state ("drone transparency dashboard", "DFR dashboard"). Output is **agency names**, not slugs. Named-but-not-found agencies from today: Huntsville PD and Ohio DOT (AirData per press, never located).

**A5. Municipal-site link harvest — the precision source.** For every agency name from A1–A4 plus our 25 `needs_review` entries: find the agency's own drone-program page (site search or `<city> police drone program`), extract outbound links to any dashboard host. Agencies *want* these pages found; their own link is the authoritative pointer and the way we discovered Elk Grove's Flock URL. This also catches one-off self-hosted dashboards (Salt Lake City, Montgomery County MD, Santa Clara, DC MPD, Washoe County) that belong in the directory even if V1 never ingests them.

**A6. Targeted slug conversion, last.** Only for names from A4/A5 that indexes did not resolve: try that agency's name against each platform's known patterns (AirData: `<initials>pd`, `<city>pd`, `<dept-initials><type>`; CAPE: `<city>pd`, `<city><st>`, `<city>pd-<st>`). No more blind mass sweeps — they cost the most and proved the least.

**Etiquette, all phases:** identify ourselves with a honest User-Agent and contact address; respect `robots.txt` (AirData: `Crawl-delay: 2`, `/u/` allowed, `/kml*` disallowed — so no KML path pulls); concurrency ≤ 4 per host; back off on 429/403.

## 2. Phase B — Verify and characterize every candidate

One record per candidate site in a new `data/source_census.json` (machine-readable; this file IS a deliverable and later feeds the site's directory page):

```
{ platform, slug_or_url, agency_name_claimed, live: yes|no|challenge,
  has_flight_data: yes|no|unknown, est_rows, date_range, fields_seen,
  retention: full|rolling(<days>)|unknown, publish_delay, robots_notes,
  verdict: COLLECT | DIRECTORY_ONLY | DEAD, matched_agency_id | null }
```

Liveness tests per platform: CAPE `project-settings` API (200 vs 404); AirData byte-size (>5 KB real, 154 empty); Flock **one** headless-browser load per hostname (a single page view is what any resident does; record live/challenge/404 and the visible flight count — nothing more in this phase); Socrata/Hub dataset metadata API.

**Verdict rules:** `COLLECT` needs live + flight-level rows + an access path we can operate respectfully. `DIRECTORY_ONLY` = live but not collectable yet (all Flock, pending the decision below; self-hosted one-offs). `DEAD` = provisioned/archived only, kept for the record.

## 3. Phase C — Identity and merge design (the hard part; do before pulling)

**C1. Canonical agency mapping.** Every census row maps to a canonical `agency_id` (existing registry where overlap; new otherwise). Expect ~15–25 multi-platform agencies.

**C2. Schema evolution.** The registry's single `source`/`source_config` becomes `sources: [{platform, config, retention, pull_strategy}]`. `FlightRecord` gains a `source` field (which platform this record came from). The compact flight-file format gains the column; the validator learns it. This is the one breaking change — do it first, migrate the 136 existing files mechanically, and keep `agency_id` URLs stable (spec rule: they never change).

**C3. Cross-source dedupe — the double-counting rule.** Within an agency, two records from different sources are the same flight iff `flight_date_local` matches AND case numbers match exactly (both non-null). If either lacks a case number, fall back to date + takeoff time within ±5 minutes where both have times. **Anything weaker stays un-merged and both records are kept**, each with provenance, and the agency page states the counting rule. Never fuzzy-match on location or purpose. Write the dedupe as a pure, heavily-tested function; run an overlap report (Everett is the test case: do its 10 Skydio flights appear among its AirData records?) before trusting any merged count. Per-source counts remain visible on the agency page so a merge bug is *visible*, not silent.

**C4. Pull strategies become per-source:**
- `replace` (current behavior): Skydio, AirData, Socrata — sources that expose full history; the zero-row and count-verification guards stay.
- `accumulate`: CAPE — union by `source_flight_id`, never delete, track `first_seen`/`last_seen` per record; a record aging out of the vendor window is retained and marked. **Deferral cost to surface to Jeff:** while the weekly refresh remains deferred, every 30 days without a manual CAPE pull permanently loses that window. Recommendation: a minimal CAPE-only scheduled pull is justified now even though the full refresh design stays deferred; his call.

**C5. Flock decision (needs Jeff).** Options: (a) directory-only in V1 — list all live Flock dashboards with links, collect nothing (my recommendation: 87 candidates × Cloudflare-challenged browser automation is heavy, fragile, and arguably against the operator's expressed preference; the directory alone is real value); (b) headless collection of the current view for the subset that renders, low frequency; (c) contact Flock/agencies for sanctioned access — cheap to attempt in parallel with (a).

## 4. Phase D — Pull (Opus, overnight where needed)

- **AirData adapter** (~10 agencies): walk `?month=MYYYY&pageno=N` from each portal's own month list; 6 rows/page; honor Crawl-delay 2 (≈1 req/2s/host — Chula Vista alone is thousands of requests: run as a resumable overnight job with incremental per-agency, per-month saves). No native flight id → synthesize `sha1(agency|date|time|case|location|rowIndexWithinTimestamp)` documented as such. No duration field → null, source-level note (per §4.1 rule: never per-record `data_quality`). Termination: a month is complete when a page returns < 6 rows; verify by re-walking the last page; months enumerate from the portal's own month list, never assumed.
- **CAPE adapter** (8+): trivial JSON pull; accumulate semantics per C4; store the window/delay from `project-settings` in the registry.
- **Generic Socrata adapter**: refactor `sfpd_datasf` into `socrata` with per-agency field mapping in `source_config` (SFPD becomes config, not code). Any A3 finds become config entries.
- All pulls keep the invariants that earned their scars: per-agency isolation, zero-row-with-history rejection, corrupt-file detection, count-verification where the source can state a total, distinct-flight counting, no identity fields, no geometry.

## 5. Phase E — V1 site completion

1. Land the pending suppression work (written/tested, uncommitted) — and note the rule composes correctly with merging: Las Vegas is suppressed today on its 3-flight Skydio record and **automatically returns** when its AirData record merges in, because active-days is computed on the merged set.
2. Agency pages show per-source provenance: which platforms, per-source counts, per-source freshness, and the dedupe rule in plain words.
3. **New “Directory” page — the census as content.** Every known live transparency site (including DIRECTORY_ONLY Flock and self-hosted dashboards) with platform, agency, link, live-status, and whether we ingest it. This is the page that makes V1 “the place where all of this is findable,” even where we do not yet hold the data.
4. About page: per-platform methodology, floors-vs-counts honesty, the multi-publishing and dedupe explanation.
5. Then: repo push, CI, Vercel preview → production per house rules (verify in browser first), and the deferred weekly-refresh design revisited with real multi-source semantics in hand.

## 6. Order, effort, checkpoints

A (enumerate) ≈ 2–3h, mostly waiting on index queries — parallelizable. B (verify) ≈ 2–3h. C (schema+dedupe design/tests) ≈ 2–3h and gates everything. D: CAPE+Socrata ≈ 2h; AirData overnight unattended. E ≈ 4–6h.

Checkpoints for Jeff: end of B (census table — decide Flock option and bless the COLLECT list), end of C (dedupe rule + overlap report on Everett before any merged number ships), end of E (preview before production).

Known open items carried in: Huntsville PD / Ohio DOT unlocated on AirData; `needs_review` backlog (25) gets another pass via A5; the suppression commit message should name AirData (not "another platform") for the Las Vegas example.

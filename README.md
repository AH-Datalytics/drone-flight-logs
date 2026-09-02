# Police Drone Flight Log Explorer

This repository collects drone flight logs that police and public-safety agencies have already published, and stores them as versioned JSON files. There are two sources today: Skydio's public transparency dashboards (135 agencies) and the San Francisco Police Department's dataset on the city's open-data portal (1 agency). The committed dataset currently covers 136 agencies and 109,373 distinct flight records.

No flight-path geometry is stored, no pilot or vehicle identity fields are kept, and nothing is fetched from the site at read time — this repository is the data layer for a future site, not the site itself.

## Commands

- `npm test` — the Vitest suite (78 tests): adapters, merge/de-dup, pipeline safety, schema validation.
- `npm run validate:data` — cross-checks the committed data in `data/` against the registry and the record schema. Exits 1 and lists every problem found; exits 0 with "data/ valid" otherwise.
- `npm run pull` — runs the real pipeline against live services: re-discovers Skydio dashboards, pulls every non-`needs_review`, non-`retired` agency, writes `data/flights/`, and recomputes registry summaries and `data/manifest.json`. Flags: `-- --no-discover` skips re-discovery; `-- --only=agency-id-1,agency-id-2` pulls only the named agencies.
- `npm run seed` — the one-time bootstrap that built the initial registry and data from a hand-exported CSV. Already run; not needed again in normal operation.
- `pipeline/seed-fixups.ts` — a one-time migration that merged multi-dashboard agencies and hand-set a few timezones after the initial seed. Already run (2026-09-01); kept for the record, not exposed as an `npm run` script, and not meant to be re-run.

## Data layout

- `data/registry.json` — one record per agency: identity, source configuration, curated fields, and pipeline-maintained status/summary fields. Partly hand-curated, partly refreshed by the pipeline.
- `data/manifest.json` — the outcome of the last pipeline run: per-agency status (`ok`, `stale`, `unreachable`, `retired`) and row count.
- `data/flights/<agency_id>.json` — one file per agency, in a compact header-plus-rows format (a `columns` array and an array of row arrays, not an array of objects) to keep the files diff-friendly and small.
- `data/excluded_orgs.json` — dashboards that are deliberately never ingested, for either of two recorded reasons: internal or demo dashboards identified by title pattern (test orgs, employee sandboxes, template dashboards — 49 entries today), and dashboards for which no feature service could be resolved (5 entries today). Each entry records its own `reason`, so the file is self-describing.
- `data/seed/` — the CSV used for the one-time bootstrap. Kept for reference; the pipeline does not read it again.

## Promoting a `needs_review` agency

When the pipeline discovers a new Skydio dashboard, it adds a registry entry with `status: "needs_review"` and a `display_name` copied from the dashboard title. An agency in this state is excluded from `npm run pull`'s targets and is not meant to be shown on the site. There are currently 25 such agencies awaiting curation.

To promote one, edit its entry in `data/registry.json` by hand:

1. Fill in `display_name` (a cleaned-up, human name), `state` (two-letter, or `null` for non-US), `org_type` (one of `law_enforcement`, `fire_ems`, `university`, `government_other`, `corporate_utility`, `vendor_partner`), `timezone` (IANA zone), and `official_url` (the agency's own flight map, or the ArcGIS dashboard URL if there isn't one).
2. Set `status` to `"ok"`.
3. Run `npm run validate:data` to confirm the entry is well-formed, then `npm run pull -- --only=<agency_id>` to pull its data.

The pipeline never edits curated fields and never deletes a registry entry, so promotion is always a manual, one-way step.

## Adding an exclusion

If the pipeline discovers a Skydio dashboard that is internal or a demo rather than a real publishing agency, add an entry to `data/excluded_orgs.json` with its `dashboard_item_id`, `org_uuid`, `title`, and a `reason`, then remove the corresponding `needs_review` entry from `data/registry.json`. Future discovery runs will skip it.

If instead a real agency's dashboard cannot be resolved to a feature service, treat that as something to investigate rather than simply exclude — it can mean Skydio has moved that agency to a dashboard or service naming convention the resolver does not yet recognise (the known example: a service named `<org>-transparency-dashboard-new` instead of the expected `<org>-production`), not that the dashboard is a demo. Discovery's failure-rate circuit breaker aborts a run if more than 10% of dashboards fail to resolve, so a wholesale naming migration on Skydio's side would surface loudly rather than quietly shrinking the census.

## Two things to know before you touch this data

1. **Counts are of distinct flight identifiers, not rows.** Several Skydio feature services publish byte-identical duplicate rows — the same flight, published two or three times. Cincinnati's service holds 30,071 rows for 17,938 real flights. Every count in this repository and anywhere downstream is a count of distinct `source_flight_id`s per agency, not a row count.
2. **`agency_id` is a permanent public URL and must never change once published.** It is the slug used for the agency's page and its flight file name. Renaming one breaks every existing link to that agency.

## Refresh schedule

The data is currently refreshed by hand by running `npm run pull` locally. A scheduled weekly refresh workflow is planned but deliberately deferred until the website exists, so the refresh can be designed against a working site instead of guessed at in isolation.

## Further reading

- Design spec: `docs/superpowers/specs/2026-09-01-drone-log-explorer-design.md`
- Pipeline implementation plan: `docs/superpowers/plans/2026-09-01-pipeline.md`
- Site implementation plan: `docs/superpowers/plans/2026-09-01-site.md`

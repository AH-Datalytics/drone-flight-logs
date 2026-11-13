# Contributing

Thanks for helping. Most useful contributions here are small: a dashboard that isn't listed yet, an agency in the wrong place, a collector that breaks quietly.

## Setup

You need Node 22 or newer.

```bash
npm ci
npm run dev                      # the site at localhost:3000
npx playwright install chromium  # only if you'll run the Flock collector
```

## Before opening a pull request

CI runs the first two of these. Please run all three:

```bash
npm test
npm run validate:data
npm run typecheck
```

A pull request from a fork shows a failing **Vercel** check ("Authorization required to deploy") until a maintainer approves it. That's expected and doesn't mean anything is broken.

## Don't commit regenerated data

`data/site/` and `data/raw/` are committed, but the [monthly refresh workflow](.github/workflows/refresh.yml) is what updates them. Local runs change files you probably didn't mean to change:

- **Collectors** rewrite `data/raw/<source>/_state.json`, even when they collect nothing. Revert it with `git checkout -- data/raw` unless new data is the point of your change.
- **`npm run build:data`** marks agencies `stale` by comparing their last collection date to today. On any machine, that touches hundreds of lines in `data/site/agencies.json` that have nothing to do with your change. Commit only the lines your change is about.

To try a collector on one agency, pass `--agency <agency_id>`. Every collector accepts it:

```bash
npm run flock:collect -- --agency cobb-county-pd-ga --since 2026-10
```

## Adding a dashboard

Each source has a list of dashboards in `data/<source>_sites.json` (`flock`, `airdata`, `cape`, `brinc`, `dronesense`, `selfpub`). Add an entry shaped like the ones already there, and check `research/census/` first: many dashboards have already been found and marked dead or empty.

Skydio and San Francisco agencies live in `data/registry.json` instead.

## Fixing an agency's location on the map

Map points live in `data/agency_places.json`. If one is wrong, replace its coordinates, set `"via": "manual"`, and put what you looked up in `"query"`. The same coordinates go in that agency's entry in `data/site/agencies.json`.

## What this project doesn't collect

See [What is deliberately not collected](README.md#what-is-deliberately-not-collected): no flight paths, pilot names, aircraft serial numbers or coordinates for individual flights. A change that would store any of them won't be merged, even if a source publishes them.

## Collecting respectfully

These are public dashboards run by agencies and vendors. Keep the collectors' existing delays, and don't add ways around rate limits or bot checks. If a source blocks you locally (Flock's Cloudflare check often does), say so in your pull request rather than working around it.

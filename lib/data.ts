import 'server-only';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Registry, RegistryAgency } from '@/pipeline/registry';
import { decodeFlightFile, type FlightFile } from '@/pipeline/flightfile';
import type { FlightRecord } from '@/pipeline/schema';
import type { Manifest } from '@/pipeline/pull';

const DATA = join(process.cwd(), 'data');

export function loadRegistry(): Registry { return JSON.parse(readFileSync(join(DATA, 'registry.json'), 'utf8')); }
export function loadManifest(): Manifest { return JSON.parse(readFileSync(join(DATA, 'manifest.json'), 'utf8')); }
export function publicAgencies(): RegistryAgency[] { return loadRegistry().agencies.filter(a => a.status !== 'needs_review'); }
export function getAgency(id: string): RegistryAgency | undefined { return publicAgencies().find(a => a.agency_id === id); }
export function loadFlights(id: string): FlightRecord[] {
  const p = join(DATA, 'flights', `${id}.json`);
  if (!existsSync(p)) return [];
  return decodeFlightFile(JSON.parse(readFileSync(p, 'utf8')) as FlightFile);
}

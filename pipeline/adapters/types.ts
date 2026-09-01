import type { FlightRecord } from '../schema.js';
import type { FetchJson } from '../http.js';
import type { RegistryAgency } from '../registry.js';

export interface Adapter {
  source: string;
  pull(agency: RegistryAgency, fetchJson: FetchJson): Promise<FlightRecord[]>;
}

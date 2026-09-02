import type { Status } from '@/pipeline/registry';
const LABEL: Record<Status, string> = { ok: 'current', stale: 'stale', unreachable: 'unreachable', retired: 'retired', needs_review: 'review' };
// "stale" describes the publication, not the agency's drone program: it means no new
// flight has been PUBLISHED in 60+ days, which for a slow or batch publisher can be
// entirely normal. See the "Typical gap" column for whether that's actually unusual.
const TITLE: Record<Status, string | undefined> = {
  ok: undefined,
  stale: 'No newly published flight in over 60 days -- may reflect this agency’s publishing schedule rather than a stop in flights. Compare against its typical gap.',
  unreachable: 'Last weekly pull failed; showing previous data',
  retired: undefined,
  needs_review: undefined,
};
export default function StatusBadge({ status }: { status: Status }) { return <span className={`badge ${status}`} title={TITLE[status]}>{LABEL[status]}</span>; }

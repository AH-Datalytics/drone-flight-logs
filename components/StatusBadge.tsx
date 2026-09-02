import type { Status } from '@/pipeline/registry';
const LABEL: Record<Status, string> = { ok: 'current', stale: 'stale', unreachable: 'unreachable', retired: 'retired', needs_review: 'review' };
export default function StatusBadge({ status }: { status: Status }) { return <span className={`badge ${status}`} title={status === 'stale' ? 'No published flight in over 60 days' : status === 'unreachable' ? 'Last weekly pull failed; showing previous data' : undefined}>{LABEL[status]}</span>; }

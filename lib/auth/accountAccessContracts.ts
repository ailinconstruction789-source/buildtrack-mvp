export const ACCESS_STATES = ['active', 'awaiting_review', 'auth_unavailable', 'disabled', 'review_required'] as const;
export type AccessState = typeof ACCESS_STATES[number];
export interface AccessQuery { page: number; query: string; status: 'all' | AccessState }
export interface AccessAccount {
  userId: string; username: string; revision: number; reviewedAt: string;
  authStatus: 'available' | 'missing' | 'deleted' | 'anonymous' | 'banned'; status: AccessState;
  lastSuspension: { revision: number; reason: 'auth_banned' | 'auth_deleted' | 'auth_anonymous'; at: string } | null;
}
export interface AccessSnapshot extends AccessQuery {
  contract: 'buildtrack.account-access.v1'; actorId: string; generatedAt: string;
  pageSize: 25; total: number; accounts: AccessAccount[];
}
export const ACCESS_LABELS: Record<AccessState, string> = {
  active: 'เปิดใช้งาน', awaiting_review: 'รอ Admin รับรองใหม่', auth_unavailable: 'บัญชี Auth ใช้งานไม่ได้',
  disabled: 'ปิดสิทธิ์ตามรายการรับรอง', review_required: 'ต้องตรวจความสอดคล้องของสิทธิ์',
};
export const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const accessUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const natural = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const stamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
function invalid(): never { throw new Error('ACCOUNT_ACCESS_INVALID_DATA'); }
export function parseAccessQuery(url: string): AccessQuery {
  const params = new URL(url).searchParams;
  for (const key of params.keys()) if (!['page','query','status'].includes(key) || params.getAll(key).length !== 1) invalid();
  const rawPage = params.get('page') ?? '0', query = params.get('query') ?? '', status = params.get('status') ?? 'all';
  if (!/^(0|[1-9]\d{0,4})$/.test(rawPage) || Number(rawPage)>10000 || query.length>80 || /[\x00-\x1f\x7f]/.test(query)
    || !['all',...ACCESS_STATES].includes(status)) invalid();
  return { page: Number(rawPage), query: query.trim(), status: status as AccessQuery['status'] };
}
export function parseAccessSnapshot(raw: unknown, actorId: string, scope: AccessQuery): AccessSnapshot {
  if (!record(raw) || raw.contract !== 'buildtrack.account-access.v1' || !accessUuid(raw.actorId) || raw.actorId !== actorId
    || !stamp(raw.generatedAt) || raw.page !== scope.page || raw.query !== scope.query || raw.status !== scope.status
    || raw.pageSize !== 25 || !natural(raw.total) || !Array.isArray(raw.accounts)
    || raw.accounts.length !== Math.min(25, Math.max(0, raw.total - scope.page*25))) invalid();
  const accounts: AccessAccount[] = raw.accounts.map((row: unknown) => {
    if (!record(row) || !accessUuid(row.userId) || typeof row.username !== 'string' || !row.username.trim()
      || row.username.length>500 || !natural(row.revision) || !stamp(row.reviewedAt)
      || !['available','missing','deleted','anonymous','banned'].includes(String(row.authStatus))
      || !ACCESS_STATES.includes(row.status as AccessState) || (scope.status !== 'all' && row.status !== scope.status)
      || ((row.authStatus === 'available') === (row.status === 'auth_unavailable'))) invalid();
    let lastSuspension: AccessAccount['lastSuspension'] = null;
    if (row.lastSuspension !== null) {
      const h = row.lastSuspension;
      if (!record(h) || !natural(h.revision) || !stamp(h.at) || !['auth_banned','auth_deleted','auth_anonymous'].includes(String(h.reason))) invalid();
      lastSuspension = { revision: h.revision, reason: h.reason as NonNullable<AccessAccount['lastSuspension']>['reason'], at: h.at };
    }
    if (row.status === 'awaiting_review' && (!lastSuspension || lastSuspension.revision < row.revision)) invalid();
    if (row.status === 'active' && (row.revision === 0 || (lastSuspension && lastSuspension.revision >= row.revision))) invalid();
    return { userId: row.userId, username: row.username, revision: row.revision, reviewedAt: row.reviewedAt,
      authStatus: row.authStatus as AccessAccount['authStatus'], status: row.status as AccessState, lastSuspension };
  });
  if (new Set(accounts.map(row => row.userId)).size !== accounts.length) invalid();
  // Construct an allowlisted response. Never forward email, PIN or metadata extras.
  return { contract: 'buildtrack.account-access.v1', actorId, generatedAt: raw.generatedAt,
    ...scope, pageSize: 25, total: raw.total, accounts };
}

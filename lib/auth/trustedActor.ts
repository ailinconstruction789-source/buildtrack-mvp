export const APP_ROLES = ['Admin','Owner','Sales','Foreman','Site Engineer','QC','Project Planner','Procurement','Store'] as const;
export type AppRole = typeof APP_ROLES[number];
export interface TrustedActor {
    contract: 'buildtrack.actor.v1'; authUserId: string; legacyUserId: number;
    username: string; role: AppRole; canManageAccounts: boolean;
}
export const TRUSTED_AUTH_ERROR = 'ยังยืนยันสิทธิ์ของบัญชีไม่ได้ กรุณาลองเข้าสู่ระบบใหม่หรือติดต่อ Admin';
export const TRUSTED_AUTH_ENABLED = process.env.NEXT_PUBLIC_ACCOUNT_TRUSTED_AUTH_ENABLED === 'true';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseTrustedActor(raw: unknown, expectedUserId: string): TrustedActor {
    if (!raw || typeof raw !== 'object') throw new Error(TRUSTED_AUTH_ERROR);
    const row = raw as Record<string, unknown>;
    if (row.contract !== 'buildtrack.actor.v1' || typeof row.authUserId !== 'string' || !uuid.test(row.authUserId)
        || row.authUserId !== expectedUserId || !Number.isSafeInteger(row.legacyUserId) || (row.legacyUserId as number) <= 0
        || typeof row.username !== 'string' || !row.username.trim()
        || !APP_ROLES.includes(row.role as AppRole) || typeof row.canManageAccounts !== 'boolean'
        || (row.canManageAccounts && row.role !== 'Admin')) throw new Error(TRUSTED_AUTH_ERROR);
    return { contract:'buildtrack.actor.v1',authUserId:row.authUserId,legacyUserId:row.legacyUserId as number,
        username:row.username,role:row.role as AppRole,canManageAccounts:row.canManageAccounts };
}
export interface ActorSession { access_token: string; user: { id: string } }
export interface ActorClient {
    auth: {
        getSession(): PromiseLike<{ data: { session: ActorSession | null }; error: unknown }>;
        getUser(token: string): PromiseLike<{ data: { user: { id: string } | null }; error: unknown }>;
    };
    rpc(name: 'app_current_actor' | 'app_touch_current_user'): PromiseLike<{ data: unknown; error: unknown }>;
}
export async function readTrustedActor(client: ActorClient): Promise<TrustedActor> {
    const before = await client.auth.getSession();
    const session = before.data.session;
    if (before.error || !session) throw new Error(TRUSTED_AUTH_ERROR);
    // getSession supplies a token, never permissions. Verify identity with Auth.
    const verified = await client.auth.getUser(session.access_token);
    if (verified.error || !verified.data.user || verified.data.user.id !== session.user.id) throw new Error(TRUSTED_AUTH_ERROR);
    const result = await client.rpc('app_current_actor');
    if (result.error) throw new Error(TRUSTED_AUTH_ERROR); // No metadata fallback, including missing RPC.
    const actor = parseTrustedActor(result.data, verified.data.user.id);
    const after = await client.auth.getSession();
    if (after.error || after.data.session?.access_token !== session.access_token
        || after.data.session.user.id !== actor.authUserId) throw new Error(TRUSTED_AUTH_ERROR);
    return actor;
}

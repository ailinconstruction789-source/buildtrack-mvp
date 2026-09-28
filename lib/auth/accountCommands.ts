// Off until the reviewed SQL and matching client are deployed together.
// This flag is UI compatibility only; authorization is enforced by the database.
export const GUARDED_ACCOUNT_COMMANDS_ENABLED = process.env.NEXT_PUBLIC_ACCOUNT_GUARDED_COMMANDS_ENABLED === 'true';
export const ACCOUNT_COMMANDS_NOT_READY = 'ระบบจัดการบัญชียังไม่พร้อมสำหรับชุดคำสั่งใหม่ กรุณาติดต่อ Admin';

type AccountCommand = { action: 'create'; username: string; role: string } | { action: 'delete'; username: string };
export interface AccountCommandClient {
    rpc(name: 'app_account_command_capabilities' | 'admin_create_user' | 'admin_delete_user',
        args?: Record<string, string>): PromiseLike<{ data: unknown; error: unknown }>;
}

export async function runGuardedAccountCommand(client: AccountCommandClient, command: AccountCommand): Promise<void> {
    const capability = await client.rpc('app_account_command_capabilities');
    const value = capability.data as { contract?: unknown; atomicForeman?: unknown } | null;
    if (capability.error || !value || value.contract !== 'buildtrack.account-commands.v1' || value.atomicForeman !== true) {
        throw new Error(ACCOUNT_COMMANDS_NOT_READY);
    }
    // Never write foremen from the browser, retry a mutation automatically, or
    // fall back to the legacy two-step path if the guard/capability rejects it.
    const result = command.action === 'create'
        ? await client.rpc('admin_create_user', { p_username: command.username, p_role: command.role })
        : await client.rpc('admin_delete_user', { p_username: command.username });
    if (result.error) throw result.error;
}

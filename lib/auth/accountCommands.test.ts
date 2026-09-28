// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ACCOUNT_COMMANDS_NOT_READY, runGuardedAccountCommand } from './accountCommands';

const ready = { data: { contract: 'buildtrack.account-commands.v1', atomicForeman: true }, error: null };
describe('guarded account commands', () => {
    it.each([
        { action: 'create' as const, username: 'synthetic', role: 'Foreman' },
        { action: 'delete' as const, username: 'synthetic' },
    ])('uses a capability check and exactly one mutation: $action', async command => {
        const rpc = vi.fn().mockResolvedValueOnce(ready).mockResolvedValueOnce({ data: null, error: null });
        await runGuardedAccountCommand({ rpc }, command);
        expect(rpc.mock.calls).toEqual([
            ['app_account_command_capabilities'],
            command.action === 'create'
                ? ['admin_create_user', { p_username: 'synthetic', p_role: 'Foreman' }]
                : ['admin_delete_user', { p_username: 'synthetic' }],
        ]);
    });
    it.each([
        { data: null, error: { message: 'missing function' } },
        { data: {}, error: null },
        { data: { contract: 'old', atomicForeman: true }, error: null },
        { data: { contract: 'buildtrack.account-commands.v1', atomicForeman: false }, error: null },
        { data: { contract: 'buildtrack.account-commands.v1', atomicForeman: 'true' }, error: null },
    ])('does not mutate or fall back on incompatible capability', async response => {
        const rpc = vi.fn().mockResolvedValue(response);
        await expect(runGuardedAccountCommand({ rpc }, { action: 'create', username: 'synthetic', role: 'Foreman' }))
            .rejects.toThrow(ACCOUNT_COMMANDS_NOT_READY);
        expect(rpc).toHaveBeenCalledTimes(1);
    });
    it('does not retry or fall back after a denied mutation', async () => {
        const error = { message: 'ACCOUNT_ADMIN_REQUIRED' };
        const rpc = vi.fn().mockResolvedValueOnce(ready).mockResolvedValueOnce({ data: null, error });
        await expect(runGuardedAccountCommand({ rpc }, { action: 'delete', username: 'synthetic' })).rejects.toBe(error);
        expect(rpc).toHaveBeenCalledTimes(2);
    });
});

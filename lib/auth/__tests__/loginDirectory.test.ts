// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { LOGIN_DIRECTORY_ERROR, parseLoginNames, readLoginNames } from '../loginDirectory';

function mockClient(pages: { data: unknown; count: number | null; error?: unknown }[]) {
    let page = 0;
    const range = vi.fn(async () => ({ error: null, ...pages[page++] }));
    const order = vi.fn(() => ({ range }));
    const select = vi.fn(() => ({ order }));
    const from = vi.fn(() => ({ select }));
    return { client: { from }, from, select, order, range };
}
describe('public login name reader', () => {
    it('selects/sorts only username, never requests full users or role', async () => {
        const mock = mockClient([{ data: [{ username: 'Sales A', role: 'Admin', last_seen_at: 'secret' }], count: 1 }]);
        expect(await readLoginNames(mock.client)).toEqual([{ username: 'Sales A' }]);
        expect(mock.from).toHaveBeenCalledWith('users');
        expect(mock.select).toHaveBeenCalledExactlyOnceWith('username', { count: 'exact' });
        expect(mock.order).toHaveBeenCalledExactlyOnceWith('username', { ascending: true });
    });
    it('follows the actual API row cap without silently truncating names', async () => {
        const mock = mockClient([{ data: [{ username: 'A' }], count: 2 }, { data: [{ username: 'B' }], count: 2 }]);
        expect(await readLoginNames(mock.client)).toEqual([{ username: 'A' }, { username: 'B' }]);
        expect(mock.range.mock.calls).toEqual([[0,199],[1,200]]);
    });
    it('keeps exact usernames and distinguishes empty directory', async () => {
        expect(parseLoginNames([{ username: '  คนทดสอบ  ' }])).toEqual([{ username: '  คนทดสอบ  ' }]);
        expect(await readLoginNames(mockClient([{ data: [], count: 0 }]).client)).toEqual([]);
    });
    it.each([null, {}, [null], [{ username: 2 }], [{ username: '' }], [{ username: '  ' }]])('rejects malformed data %j', data => {
        expect(() => parseLoginNames(data)).toThrow(LOGIN_DIRECTORY_ERROR);
    });
    it.each([
        [{ data: [], count: null }], [{ data: [], count: -1 }], [{ data: [], count: 10001 }],
        [{ data: [], count: 1 }], [{ data: [{ username: 'A' }], count: 0 }],
        [{ data: [{ username: 'A' }], count: 1, error: { message: 'internal secret' } }],
        [{ data: [{ username: 'A' }], count: 2 }, { data: [{ username: 'B' }], count: 3 }],
        [{ data: [{ username: 'A' }], count: 2 }, { data: [{ username: 'A' }], count: 2 }],
    ])('fails closed, with no broad-read fallback: %j', async (...pages) => {
        const mock = mockClient(pages);
        await expect(readLoginNames(mock.client)).rejects.toThrow(LOGIN_DIRECTORY_ERROR);
        for (const args of mock.select.mock.calls) expect(args).toEqual(['username', { count: 'exact' }]);
    });
});

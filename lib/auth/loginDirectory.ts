/** Intentionally public names only. This is NOT an identity/authorization source. */
export interface LoginName { username: string }

export interface LoginDirectoryClient {
    from(table: 'users'): {
        select(columns: 'username', options: { count: 'exact' }): {
            order(column: 'username', options: { ascending: true }): {
                range(from: number, to: number): PromiseLike<{ data: unknown; error: unknown; count: number | null }>
            }
        }
    }
}

export const LOGIN_DIRECTORY_ERROR = 'โหลดรายชื่อไม่สำเร็จ กรุณาลองใหม่ หากยังไม่ได้ให้ติดต่อ Admin';
const PAGE_SIZE = 200;
const MAX_NAMES = 10_000;

export function parseLoginNames(value: unknown): LoginName[] {
    if (!Array.isArray(value)) throw new Error(LOGIN_DIRECTORY_ERROR);
    return value.map(row => {
        if (!row || typeof row !== 'object' || typeof row.username !== 'string' || !row.username.trim()) {
            throw new Error(LOGIN_DIRECTORY_ERROR);
        }
        // Never spread a database row: even unexpected extra fields stay out of UI state.
        return { username: row.username };
    });
}

export async function readLoginNames(client: LoginDirectoryClient): Promise<LoginName[]> {
    const result: LoginName[] = [];
    let expectedCount: number | null = null;
    // Exact count prevents silently truncating the dropdown at the Data API row cap.
    // No role/id/online sort, wildcard SELECT or broad-read fallback is allowed.
    while (true) {
        const { data, error, count } = await client.from('users')
            .select('username', { count: 'exact' })
            .order('username', { ascending: true })
            .range(result.length, result.length + PAGE_SIZE - 1);
        if (error || count === null || !Number.isInteger(count) || count < 0 || count > MAX_NAMES
            || (expectedCount !== null && count !== expectedCount)) throw new Error(LOGIN_DIRECTORY_ERROR);
        expectedCount = count;
        const page = parseLoginNames(data);
        if (page.length > PAGE_SIZE || result.length + page.length > count
            || (page.length === 0 && result.length < count)) throw new Error(LOGIN_DIRECTORY_ERROR);
        result.push(...page);
        if (new Set(result.map(row => row.username)).size !== result.length) throw new Error(LOGIN_DIRECTORY_ERROR);
        if (result.length === count) return result;
    }
}

import { describe, expect, it } from 'vitest';
import { CENTRAL_SEARCH_CONTRACT_VERSION, CentralInputError, EMPTY_CENTRAL_SEARCH, parseCentralCreateInput, parseCentralPage,
    parseCentralSearchFilters, parseCentralSearchQuery, parseCentralSearchSnapshot } from '../centralContracts';

const valid = {
    requestId: '00000000-0000-4000-8000-000000000001',
    name: ' ลูกค้าทดสอบ ', phone: ' 081-234-5678 ', channel: ' โทร ', notes: ' ', interests: [],
};

describe('central intake input boundary', () => {
    it('requires only intake data, without a project or client-supplied owner', () => {
        expect(parseCentralCreateInput(valid)).toEqual({ ...valid, name: 'ลูกค้าทดสอบ', phone: '081-234-5678', channel: 'โทร', notes: '' });
    });

    it('keeps text plot IDs and independent optional plots for multiple projects', () => {
        const interests = [{ projectName: 'โครงการ A', plotId: 'โครงการ A-1' }, { projectName: 'โครงการ B', plotId: null }];
        expect(parseCentralCreateInput({ ...valid, interests }).interests).toEqual(interests);
    });

    it.each(['ownerUserId', 'createdByUserId', 'role', 'intakeStatus', 'workspaceState', 'legacyLeadId',
        'record_origin', 'recordOrigin', 'phone_data_status', 'phoneDataStatus', 'legacy_source_lead_id', 'legacySourceLeadId', '__proto__'])(
        'rejects unapproved top-level field %s instead of silently stripping it', field => {
            expect(() => parseCentralCreateInput({ ...valid, [field]: 'attacker' })).toThrow(CentralInputError);
        },
    );

    it.each([
        { name: '' }, { name: 'a'.repeat(201) }, { phone: null }, { phone: undefined }, { phone: '' }, { phone: '   ' }, { phone: '123456' }, { phone: '1234567890123456' },
        { phone: '081<script>1234' }, { channel: '' }, { channel: 'a'.repeat(81) }, { notes: 'a'.repeat(4001) },
        { notes: null }, { name: 'bad\u0000name' }, { requestId: 'not-uuid' }, { assignedSalesUserId: null },
        { assignedSalesUserId: 'sales-name' }, { interests: null },
        { interests: [{ projectName: 'A', plotId: null }, { projectName: ' A ', plotId: null }] },
        { interests: [{ projectName: 'A', plotId: null, ownerUserId: valid.requestId }] },
        { interests: [{ projectName: '', plotId: null }] }, { interests: [{ projectName: 'A' }] },
        { interests: [{ projectName: 'A', plotId: '' }] }, { interests: [{ projectName: 'A', plotId: 'x'.repeat(256) }] },
        { interests: Array.from({ length: 21 }, (_, i) => ({ projectName: String(i), plotId: null })) },
    ])('rejects malformed or oversized data: %j', change => {
        expect(() => parseCentralCreateInput({ ...valid, ...change })).toThrow(CentralInputError);
    });

    it.each([null, [], 'text', 123, {}])('rejects invalid body %j', value => {
        expect(() => parseCentralCreateInput(value)).toThrow(CentralInputError);
    });

    it('accepts formatted international phone and explicit Admin Sales selection', () => {
        expect(parseCentralCreateInput({ ...valid, phone: '+66 (81) 234-5678', assignedSalesUserId: valid.requestId }))
            .toMatchObject({ phone: '+66 (81) 234-5678', assignedSalesUserId: valid.requestId });
    });
});

describe('bounded central pagination', () => {
    it.each([['', 0], ['?page=0', 0], ['?page=123', 123], ['?page=100000', 100000]])('parses %s', (query, expected) => {
        expect(parseCentralPage(`https://app.test/api/sales-crm/central${query}`)).toBe(expected);
    });

    it.each(['?page=', '?page=-1', '?page=1.5', '?page=1e2', '?page=NaN', '?page=100001', '?page=01', '?page=1&page=2', '?pageSize=1000', '?ownerUserId=attacker'])(
        'rejects %s', query => expect(() => parseCentralPage(`https://app.test/api/sales-crm/central${query}`)).toThrow(CentralInputError),
    );
});

describe('whole-registry central search contract', () => {
    it('normalizes only query whitespace and UUID case, keeping exact channel/project identities', () => {
        expect(parseCentralSearchFilters({ ...EMPTY_CENTRAL_SEARCH, search: ' \u00a0%_\\\ufeff ', project: ' A ', channel: ' โทร ',
            owner: 'AAAAAAAA-0000-4000-8000-000000000001' })).toEqual({ ...EMPTY_CENTRAL_SEARCH, search: '%_\\', project: ' A ', channel: ' โทร ',
                owner: 'aaaaaaaa-0000-4000-8000-000000000001' });
    });
    it('accepts Unicode codepoints at the exact bound and one-character literal search', () => {
        expect(parseCentralSearchFilters({ ...EMPTY_CENTRAL_SEARCH, search: '😀'.repeat(200) }).search).toHaveLength(400);
        expect(parseCentralSearchQuery('https://local.test/?search=%25&status=legacy_unclassified').filters.search).toBe('%');
    });
    it.each([{ search: 'x'.repeat(201) }, { search: '\nname' }, { search: 'name\u0085' }, { search: '\uD800' }, { search: '\uDC00' }, { search: null },
        { owner: 'somebody' }, { status: 'following_up' }, { channel: 'x'.repeat(81) }, { project: 'x'.repeat(201) },
        { unassignedOnly: 'true' }, { unassignedOnly: true, project: 'A' }, { actor: 'admin' }])('rejects invalid scope %j', change => {
        expect(() => parseCentralSearchFilters({ ...EMPTY_CENTRAL_SEARCH, ...change })).toThrow(CentralInputError);
    });
    it.each(['?search=a&search=b', '?unassignedOnly=1', '?project=A&unassignedOnly=true', '?page=01', '?pageSize=100', '?role=admin'])('rejects query %s', query => {
        expect(() => parseCentralSearchQuery(`https://local.test/${query}`)).toThrow(CentralInputError);
    });
    const data = () => ({ actor: { userId: valid.requestId, role: 'sales' }, projects: [], salesOwners: [], customers: [], page: 0, hasMore: false,
        search: { contractVersion: CENTRAL_SEARCH_CONTRACT_VERSION, filters: { ...EMPTY_CENTRAL_SEARCH }, projects: [], owners: [], channels: ['โทร'], hasMoreChannels: false } });
    it('accepts JSONB key order while preserving exact query/filter scope and projecting only safe fields', () => {
        const input = data(); input.search.filters = { unassignedOnly: false, owner: '', channel: '', status: '', project: '', search: '' };
        expect(parseCentralSearchSnapshot({ ...input, income: 'secret' }, EMPTY_CENTRAL_SEARCH, 0)).toEqual(data());
    });
    it.each([
        (v: ReturnType<typeof data>) => ({ ...v, page: 1 }),
        (v: ReturnType<typeof data>) => ({ ...v, hasMore: true }),
        (v: ReturnType<typeof data>) => ({ ...v, search: { ...v.search, contractVersion: 'central_intake_v1' } }),
        (v: ReturnType<typeof data>) => ({ ...v, search: { ...v.search, filters: { ...v.search.filters, search: 'other' } } }),
        (v: ReturnType<typeof data>) => ({ ...v, search: { ...v.search, filters: { ...v.search.filters, search: ' ' } } }),
        (v: ReturnType<typeof data>) => ({ ...v, search: { ...v.search, channels: ['โทร', 'โทร'] } }),
        (v: ReturnType<typeof data>) => ({ ...v, search: { ...v.search, channels: Array.from({ length: 201 }, (_, i) => String(i)) } }),
    ])('rejects wrong page, scope, suggestions or contract', mutate => {
        expect(() => parseCentralSearchSnapshot(mutate(data()), EMPTY_CENTRAL_SEARCH, 0)).toThrow(CentralInputError);
    });
});

import { describe, expect, it } from 'vitest';
import { CentralInputError, parseCentralCreateInput, parseCentralPage } from '../centralContracts';

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

// Offline review of normalized source data only. No IO, database, SQL or mutation.
// Not an Excel parser, import payload, deletion manifest or permission to cut over.
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const key = v => typeof v === 'string' && v.length > 0 && v === v.trim();
const day = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
    && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const stages = new Set(['booked', 'contracted', 'downpayment', 'document_prep',
    'loan_submitted', 'loan_rejected', 'loan_approved', 'transfer_pending',
    'transferred', 'handover', 'cancelled']);
const intake = new Set(['new', 'contacted', 'following_up', 'nurture', 'lost', 'legacy_unclassified']);
const engagement = new Set(['new', 'contacted', 'considering', 'follow_up', 'nurture', 'lost']);
const phoneKey = phone => {
    const digits = phone.replace(/[^0-9]/g, '');
    return digits.startsWith('0066') ? '0' + digits.slice(4)
        : digits.startsWith('66') ? '0' + digits.slice(2) : digits;
};

/** Contract is documented in docs/sales-crm-replacement-snapshot.md.
 * Reference catalog must later be refreshed from separately verified read-only data.
 * This report contains row numbers and codes, never names, phones or account IDs.
 */
export function reviewReplacementSnapshot(snapshot, catalog) {
    const errors = [], warnings = [];
    const add = (list, code, section = 'snapshot', row = null) => list.push({ code, section, row });
    const fail = (code, section, row) => add(errors, code, section, row);
    const warn = (code, section, row) => add(warnings, code, section, row);
    const result = () => ({ contract: 'sales-replacement-review-v1',
        canProceedToMappingReview: errors.length === 0, importReady: false,
        deletionAuthorized: false, productionChanged: false, errors, warnings,
        counts: Object.fromEntries(['customers', 'interests', 'bookings'].map(s =>
            [s, Array.isArray(snapshot?.[s]) ? snapshot[s].length : 0])) });
    if (!object(snapshot) || snapshot.version !== 'sales-replacement-source-v1'
        || snapshot.mode !== 'full_snapshot' || !key(snapshot.sourceRevision)
        || !day(snapshot.asOfDate) || !['full', 'latest_only', 'unknown'].includes(snapshot.historyCoverage)
        || !['customers', 'interests', 'bookings'].every(s => Array.isArray(snapshot[s]))) {
        fail('SOURCE_CONTRACT_INVALID'); return result();
    }
    if (!object(catalog) || !Array.isArray(catalog.projects) || !catalog.projects.every(key)
        || new Set(catalog.projects).size !== catalog.projects.length
        || !Array.isArray(catalog.salesOwners) || !catalog.salesOwners.every(key)
        || new Set(catalog.salesOwners).size !== catalog.salesOwners.length
        || !Array.isArray(catalog.plots) || !catalog.plots.every(p => object(p) && key(p.id)
            && catalog.projects.includes(p.project))
        || new Set(catalog.plots.map(p => p.id)).size !== catalog.plots.length) {
        fail('REFERENCE_CATALOG_INVALID'); return result();
    }
    if (!snapshot.customers.length) fail('EMPTY_REPLACEMENT_BLOCKED');
    for (const section of ['customers', 'interests', 'bookings']) {
        if (!Number.isSafeInteger(snapshot.declaredCounts?.[section])
            || snapshot.declaredCounts[section] !== snapshot[section].length) fail('SOURCE_COUNT_MISMATCH', section);
    }
    if (snapshot.historyCoverage !== 'full') warn('HISTORY_NOT_PROVEN_COMPLETE');
    const projects = new Set(catalog.projects), owners = new Set(catalog.salesOwners);
    const plots = new Map(catalog.plots.map(p => [p.id, p.project]));
    const customers = new Set(), interests = new Map(), bookingKeys = new Set();
    const phones = new Map(), customerProjects = new Set(), occupied = new Map();
    const unique = (value, seen, section, row) => {
        if (!key(value)) fail('SOURCE_KEY_REQUIRED', section, row);
        else if (seen.has(value)) fail('DUPLICATE_SOURCE_KEY', section, row);
        else seen.add(value);
    };
    const date = (value, section, row) => {
        if (value === null) warn('DATE_UNKNOWN', section, row);
        else if (!day(value) || value > snapshot.asOfDate) fail('EVENT_DATE_INVALID', section, row);
    };
    snapshot.customers.forEach((c, i) => {
        const row = i + 1, section = 'customers';
        if (!object(c)) { fail('ROW_INVALID', section, row); return; }
        unique(c.sourceKey, customers, section, row);
        if (!key(c.name)) fail('CUSTOMER_NAME_REQUIRED', section, row);
        if (!owners.has(c.owner)) fail('SALES_OWNER_UNREVIEWED', section, row);
        if (!intake.has(c.status)) fail('STATUS_MAPPING_REQUIRED', section, row);
        date(c.leadDate, section, row);
        if (c.phone === null && c.phoneStatus === 'unknown') warn('PHONE_UNKNOWN', section, row);
        else if (c.phoneStatus !== 'provided' || typeof c.phone !== 'string'
            || !/^\+?[0-9 ()-]+$/.test(c.phone) || !/^\d{7,15}$/.test(c.phone.replace(/[^0-9]/g, ''))) {
            fail('PHONE_EVIDENCE_INVALID', section, row);
        } else {
            const normalized = phoneKey(c.phone);
            if (/^(\d)\1+$/.test(normalized)) fail('PLACEHOLDER_PHONE_REQUIRES_REVIEW', section, row);
            if (phones.has(normalized)) warn('SHARED_PHONE_DO_NOT_MERGE', section, row);
            else phones.set(normalized, row);
        }
    });
    const interestKeys = new Set();
    snapshot.interests.forEach((v, i) => {
        const row = i + 1, section = 'interests';
        if (!object(v)) { fail('ROW_INVALID', section, row); return; }
        unique(v.sourceKey, interestKeys, section, row);
        if (!customers.has(v.customerKey)) fail('CUSTOMER_REFERENCE_MISSING', section, row);
        if (!projects.has(v.project)) fail('PROJECT_REFERENCE_MISSING', section, row);
        if (!owners.has(v.owner)) fail('SALES_OWNER_UNREVIEWED', section, row);
        if (!engagement.has(v.status)) fail('STATUS_MAPPING_REQUIRED', section, row);
        const pair = JSON.stringify([v.customerKey, v.project]);
        if (customerProjects.has(pair)) fail('DUPLICATE_CUSTOMER_PROJECT', section, row);
        customerProjects.add(pair);
        if (!interests.has(v.sourceKey)) interests.set(v.sourceKey, v);
    });
    snapshot.bookings.forEach((b, i) => {
        const row = i + 1, section = 'bookings';
        if (!object(b)) { fail('ROW_INVALID', section, row); return; }
        unique(b.sourceKey, bookingKeys, section, row);
        const interest = interests.get(b.interestKey);
        if (!interest) fail('INTEREST_REFERENCE_MISSING', section, row);
        if (!plots.has(b.plotId)) fail('PLOT_REFERENCE_MISSING', section, row);
        else if (interest && plots.get(b.plotId) !== interest.project) fail('PLOT_PROJECT_MISMATCH', section, row);
        if (!stages.has(b.stage)) fail('STATUS_MAPPING_REQUIRED', section, row);
        if (stages.has(b.stage) && b.stage !== 'cancelled') {
            if (occupied.has(b.plotId)) fail('PLOT_HAS_MULTIPLE_ACTIVE_BOOKINGS', section, row);
            occupied.set(b.plotId, row);
        }
        date(b.bookedDate, section, row);
        if (b.transferredDate !== null) date(b.transferredDate, section, row);
        else if (['transferred', 'handover'].includes(b.stage)) warn('TRANSFER_DATE_UNKNOWN', section, row);
        if (b.cancelledDate !== null) date(b.cancelledDate, section, row);
        else if (b.stage === 'cancelled') warn('CANCELLATION_DATE_UNKNOWN', section, row);
        if (b.stage === 'cancelled' && b.cancelReason === null) warn('CANCELLATION_REASON_UNKNOWN', section, row);
        else if (b.stage === 'cancelled' && !key(b.cancelReason)) fail('CANCELLATION_REASON_INVALID', section, row);
        if (b.stage !== 'cancelled' && (b.cancelledDate !== null || b.cancelReason !== null)) fail('CANCELLATION_STATE_CONFLICT', section, row);
        if (!['transferred', 'handover', 'cancelled'].includes(b.stage) && b.transferredDate !== null) fail('TRANSFER_STATE_CONFLICT', section, row);
        for (const value of [b.transferredDate, b.cancelledDate]) {
            if (day(value) && day(b.bookedDate) && value < b.bookedDate) fail('EVENT_ORDER_INVALID', section, row);
        }
        for (const field of ['salePrice', 'depositAmount']) {
            const value = b[field];
            if (value === null) warn('MONEY_UNKNOWN', section, row);
            else if (typeof value !== 'number' || !Number.isFinite(value)
                || !/^\d{1,13}(\.\d{1,2})?$/.test(String(value))) {
                fail('MONEY_INVALID', section, row);
            }
        }
    });
    return result();
}

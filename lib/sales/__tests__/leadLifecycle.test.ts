import { describe, expect, it } from 'vitest';
import { canMarkLeadLost, followUpStatusPatch, hasDealHistory, isPreBookingLost, nativeLeadId, planLegacyLeadReplacement } from '../leadLifecycle';
import { purchaseNextStages, PURCHASE_STAGES } from '../purchaseFlow';
import { salesDealNextStages } from '../dealStatus';
import { postBookingTargets } from '../postBookingContracts';
import { extendRentalLeaseEnd, rentalLifecycleActions } from '../rentalLifecycle';

const lead = { id: 'L1', customer_name: 'Fixture only', status: 'Visit', crm_status: 'Follow Up' };
describe('customer lifecycle and replacement boundaries (no database writes)', () => {
  it('uses exact native identity and never treats a CRM customer ID as a Lead ID', () => {
    expect(nativeLeadId({ id: 'CRM1' })).toBeNull();
    expect(nativeLeadId({ id: 'CRM1', leadId: 'L1' })).toBe('L1');
    expect(nativeLeadId(lead)).toBe('L1');
    expect(nativeLeadId({ ...lead, id: 'SALE1', leadId: null, saleId: 'SALE1' })).toBeNull();
    expect(nativeLeadId({ ...lead, id: 'CRM1', project_interest_id: 'I1' })).toBeNull();
  });
  it.each(['Visit', 'Follow Up', 'Contacted', 'Interested'])('permits an explicit reasoned Lost decision before booking from %s', status => {
    expect(followUpStatusPatch({ ...lead, status }, 'Lost', false)).toEqual({ status: 'Lost', crm_status: 'Lost — ไม่สนใจ / ยุติการติดตาม' });
  });
  it.each([
    { status: 'Booked' }, { status: 'Reserved' }, { status: 'Contracted' }, { status: 'Transferred' },
    { status: 'Handover' }, { status: 'Cancelled' }, { status: 'Rented' }, { status: 'MovedOut' },
    { crm_stage: 'loan_rejected' }, { booking_date: '2026-01-01' }, { booking_amount: 0 },
    { notes: '🏷️ บันทึกการจอง' }, { active_rental_contract_id: 'R1' },
  ])('keeps existing deal history outside Lost/replacement/reactivation: %j', patch => {
    const row = { ...lead, ...patch };
    expect(hasDealHistory(row)).toBe(true); expect(canMarkLeadLost(row)).toBe(false);
    expect(() => followUpStatusPatch(row, 'Lost', false)).toThrow();
    expect(isPreBookingLost({ ...row, status: 'Lost', crm_status: patch.status || row.crm_status })).toBe(false);
  });
  it('keeps cancellation distinct from genuine pre-booking Lost and keeps historical notes', () => {
    expect(isPreBookingLost({ ...lead, status: 'Lost', notes: 'Customer chose another location' })).toBe(true);
    expect(isPreBookingLost({ ...lead, status: 'Cancelled' })).toBe(false);
    expect(followUpStatusPatch({ ...lead, status: 'Visit' }, 'Follow Up', true)).toEqual({});
    expect(() => followUpStatusPatch(lead, 'Lost', true)).toThrow();
  });
  it('plans only old follow-up Leads, excluding deals, missing/duplicate identities and unmatched history', () => {
    const rows = Object.freeze([
      Object.freeze(lead), { ...lead, id: 'L2', status: 'Follow Up' }, { ...lead, id: 'L3', status: 'Contracted' },
      { ...lead, id: 'L4', status: 'Transferred' }, { ...lead, id: 'L5', status: 'Cancelled' },
      { ...lead, id: 'L6', status: 'Rented' }, { ...lead, id: 'L7', status: 'Lost' },
      { id: 'CRM1', status: 'Visit' }, { ...lead, id: 'DUP' }, { ...lead, id: 'DUP' },
    ]);
    const plan = planLegacyLeadReplacement(rows, new Set(['L2']));
    expect(plan.candidates).toEqual(['L1']); expect(plan.executable).toBe(false);
    expect(plan.replacementScope).toBe('existing_visit_records');
    expect(plan.excluded).toHaveLength(9); expect(rows[0].status).toBe('Visit');
  });
  it('shares every purchase step between native Lead/Map and CRM, without offering unimplemented CRM commands', () => {
    for (const stage of PURCHASE_STAGES) for (const method of ['cash', 'mortgage'] as const) {
      expect(salesDealNextStages(stage, method)).toEqual(purchaseNextStages(stage, method));
      expect([...postBookingTargets(stage, method)].sort()).toEqual(purchaseNextStages(stage, method).filter(next => !['cancelled', 'handover'].includes(next)).sort());
    }
    expect(purchaseNextStages('loan_rejected', 'mortgage')).toEqual(['document_prep', 'cancelled']);
    expect(purchaseNextStages('loan_approved', 'cash')).toEqual([]);
    expect(purchaseNextStages('booked', null)).toEqual([]);
  });
  it('walks the full mortgage path, rejection retry and cash path without skipping approval or reopening terminal deals', () => {
    const paths = [
      ['booked', 'contracted', 'document_prep', 'loan_submitted', 'loan_rejected', 'document_prep', 'loan_submitted', 'loan_approved', 'transfer_pending', 'transferred', 'handover'],
      ['booked', 'contracted', 'downpayment', 'transfer_pending', 'transferred', 'handover'],
    ];
    paths.forEach((path, index) => path.slice(1).forEach((next, step) => expect(purchaseNextStages(path[step], index === 0 ? 'mortgage' : 'cash')).toContain(next)));
    expect(purchaseNextStages('contracted', 'mortgage')).not.toContain('transfer_pending');
    expect(purchaseNextStages('handover', 'mortgage')).toEqual([]);
    expect(purchaseNextStages('cancelled', 'cash')).toEqual([]);
  });
});
describe('rental continuation for existing A/B/C programs', () => {
  it('keeps renewal actionable and finished rentals closed', () => {
    expect(rentalLifecycleActions('Active')).toEqual(['renew', 'convert_to_buy', 'move_out']);
    expect(rentalLifecycleActions('Renewed')).toEqual(['renew', 'convert_to_buy', 'move_out']);
    expect(rentalLifecycleActions('MovedOut')).toEqual([]); expect(rentalLifecycleActions('ConvertedToBuy')).toEqual([]);
  });
  it.each([
    ['2026-01-31', 1, '2026-02-28'], ['2024-01-31', 1, '2024-02-29'],
    ['2024-02-29', 12, '2025-02-28'], ['2026-12-31', 2, '2027-02-28'], ['2026-02-28', 12, '2027-02-28'],
  ])('renews %s by %s calendar months without rolling into another month', (end, months, expected) => {
    expect(extendRentalLeaseEnd(end, months)).toBe(expected);
  });
  it.each([0, -1, 1.5, NaN, Infinity, 121])('rejects an invalid renewal duration %s', months => {
    expect(() => extendRentalLeaseEnd('2026-01-31', months)).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { parseCustomerDealEditInput, parseCustomerDealEditSnapshot, parseCustomerDealEditResult, parseCustomerDealEditQuery } from '../customerDealEditContracts';
import { editId, editInput, editResult, editScope, editSnapshot } from './customerDealEditFixtures';
describe('canonical customer and deal correction contract', () => {
  it('keeps source values distinct and explicit nulls unknown', () => {
    expect(parseCustomerDealEditInput(editInput())).toEqual(editInput());
    expect(parseCustomerDealEditSnapshot(editSnapshot(), editScope())).toEqual(editSnapshot());
    expect(parseCustomerDealEditResult(editResult(), editInput())).toEqual(editResult());
  });
  it.each([{ role: 'admin' }, { paymentMethod: 'cash' }, { stage: 'transferred' }, { occurredAt: 'now' }, { leadId: editId(99) },
    { profile: null, dealDetails: null }, { reason: '' }, { projectName: '' }, { expectedSaleRevision: null }, { expectedDealDetailsRevision: '' }])('rejects unauthorized or malformed command fields %j', patch => {
    expect(() => parseCustomerDealEditInput({ ...editInput(), ...patch })).toThrow();
  });
  it.each([0, -1, 0.01, 99999999999.1, 100000000000, NaN, Infinity, '265000000'])('rejects nonpositive or unsafe satang %s', salePriceSatang => {
    expect(() => parseCustomerDealEditInput({ ...editInput(), dealDetails: { salePriceSatang, bankName: null } })).toThrow();
  });
  it.each([null, 1, 99999999999])('supports explicit unknown or exact positive cents %s', salePriceSatang => {
    expect(parseCustomerDealEditInput({ ...editInput(), dealDetails: { salePriceSatang, bankName: null } }).dealDetails?.salePriceSatang).toBe(salePriceSatang);
  });
  it.each([{ name: '' }, { phone: '' }, { occupation: '' }, { name: '\uD800' }, { phone: '123\n456' }, { name: 'a'.repeat(201) }, { customerId: editId(9) }])('checks full profile without identity merge fields %j', patch => {
    expect(() => parseCustomerDealEditInput({ ...editInput(), profile: { ...editInput().profile, ...patch } })).toThrow();
  });
  it.each(['?saleId=bad&projectName=A', `?saleId=${editId(1)}`, `?saleId=${editId(1)}&projectName=A&projectName=B`, `?saleId=${editId(1)}&projectName=A&role=admin`])('requires an exact scope %s', q => {
    expect(() => parseCustomerDealEditQuery('https://example.invalid/'+q)).toThrow();
  });
  it.each([{ saleId: editId(99) }, { customerId: editId(99) }, { requestId: editId(99) }, { customerRevision: editId(99) },
    { interestRevision: editId(99) }, { saleRevision: editId(99) }, { customerDetailsRevision: null }, { dealDetailsRevision: null }, { command: 'advance' }])('binds every receipt to its command %j', patch => {
    expect(() => parseCustomerDealEditResult({ ...editResult(), ...patch }, editInput())).toThrow();
  });
  it('rejects changed revisions for parts not edited', () => {
    const input = { ...editInput(), profile: null };
    expect(parseCustomerDealEditResult(editResult(input), input).customerDetailsRevision).toBeNull();
    expect(() => parseCustomerDealEditResult({ ...editResult(input), customerDetailsRevision: editId(80) }, input)).toThrow();
  });
  it.each(['owner', 'sales'])('rejects forged edit rights for %s', role => {
    const s=editSnapshot(); s.actor.role=role as 'owner'|'sales'; s.customer.ownerUserId=editId(99); s.deal.ownerUserId=editId(99);
    expect(() => parseCustomerDealEditSnapshot(s,editScope())).toThrow();
  });
  it.each(['cancelled','transferred','handover'])('keeps Sales terminal deal corrections read-only %s', stage => {
    const s=editSnapshot(); s.deal.stage=stage as typeof s.deal.stage;
    expect(() => parseCustomerDealEditSnapshot(s,editScope())).toThrow();
    s.deal.canEdit=false; expect(parseCustomerDealEditSnapshot(s,editScope()).customer.canEdit).toBe(true);
  });
});

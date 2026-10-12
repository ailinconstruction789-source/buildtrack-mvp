// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseRentalCommandInput, parseRentalCommandSnapshot, parseRentalCommandResult, parseRentalCommandQuery, parseRentalCommandScope,
  parseRentalCommandPageQuery, type RentalCommandInput } from '../rentalCommandContracts';
import { rentalId, rentalInput, rentalSnapshot, rentalScope, rentalResult } from './rentalCommandFixtures';
const base = () => {
  const { command: _command, renewalMonths: _months, monthlyRentSatang: _rent, ...value } = rentalInput() as Extract<RentalCommandInput,{command:'renew'}>;
  return value;
};
const start = () => ({ ...base(), command: 'start', contractId: null, expectedContractRevision: null, plotId: 'A2', programType: 'program_b',
  startDate: '2026-01-31', durationMonths: 12, monthlyRentSatang: 1500000, securityDepositSatang: 3000000, advanceRentSatang: 1500000, savingsPerMonthSatang: 500000, basePriceSatang: null });
const conversion = () => ({ ...base(), command: 'convert_to_buy', purchaseDate: '2026-10-09', paymentMethod: 'mortgage', listPriceSatang: 250000000,
  discountSatang: 0, depositSatang: 0, bookingRoute: 'without_visit', visitId: null });

describe('canonical rental input and scoped evidence', () => {
  it('accepts all command variants without requiring a native Lead', () => {
    const inputs = [start(), rentalInput(), { ...base(), command:'end', endDate:'2026-10-09' }, conversion(),
      { ...base(), command:'record_payment', kind:'savings', amountSatang:500000, paidDate:'2026-10-09', reference:'R-1', evidenceNote:'ตรวจใบเสร็จแล้ว' }];
    for (const input of inputs) { expect(parseRentalCommandInput(input)).toEqual(input); expect(input).not.toHaveProperty('leadId'); }
  });
  it.each(['program_a','program_b','program_c'])('retains explicit source terms for %s, never infers paid savings', programType => {
    const input = { ...start(), programType, savingsPerMonthSatang:programType==='program_b'?500000:0, basePriceSatang:programType==='program_c'?250000000:null };
    expect(parseRentalCommandInput(input)).toEqual(input);
  });
  it.each([{ programType:'program_c',basePriceSatang:null }, { programType:'program_a',savingsPerMonthSatang:500000 },
    { contractId:rentalId(1) },{ expectedContractRevision:rentalId(3) },{ durationMonths:11 },{ durationMonths:121 },{ durationMonths:12.5 },
    { startDate:'2026-02-29' },{ startDate:'2026-10-09T00:00:00Z' },{ monthlyRentSatang:0 },{ securityDepositSatang:-1 },{ advanceRentSatang:0.5 }])
    ('rejects mismatched start terms %j', patch => expect(() => parseRentalCommandInput({ ...start(), ...patch })).toThrow());
  it.each([{ expectedCustomerRevision:null },{ expectedInterestRevision:'x' },{ expectedContractRevision:null },{ reason:'' },{ renewalMonths:0 },{ renewalMonths:121 },
    { monthlyRentSatang:99999999999.5 },{ customerId:rentalId(2),role:'admin' },{ stage:'transferred' },{ createdAt:'2026-10-09' },{ leadId:rentalId(9) }])
    ('rejects missing revision, identity injection and invalid money %j', patch => expect(() => parseRentalCommandInput({ ...rentalInput(), ...patch })).toThrow());
  it.each([{ discountSatang:250000000 },{ depositSatang:250000001 },{ bookingRoute:'visited' },{ visitId:rentalId(9) },{ paymentMethod:'other' },{ purchaseDate:'0000-01-01' }])
    ('rejects fabricated conversion route/amounts %j', patch => expect(() => parseRentalCommandInput({ ...conversion(), ...patch })).toThrow());
  it('allows an explicit visit only with the visited route', () => {
    expect(parseRentalCommandInput({ ...conversion(), bookingRoute:'visited', visitId:rentalId(9) })).toMatchObject({ bookingRoute:'visited',visitId:rentalId(9) });
  });
  it.each(['rent','savings','security_deposit','advance_rent'])('records actual %s evidence separately from contract amounts', kind => {
    const input = { ...base(),command:'record_payment',kind,amountSatang:10001,paidDate:'2026-02-28',reference:'R-001',evidenceNote:'receipt'};
    expect(parseRentalCommandInput(input)).toEqual(input);
    expect(() => parseRentalCommandInput({ ...input, amountSatang:0 })).toThrow();
    expect(() => parseRentalCommandInput({ ...input, reference:'' })).toThrow();
  });
  it('scope requires exact customer/project/contract and bounded individual pages', () => {
    expect(parseRentalCommandScope(rentalScope())).toEqual(rentalScope());
    expect(parseRentalCommandQuery(`https://test.invalid/?customerId=${rentalId(2)}&projectName=A&contractId=${rentalId(1)}`)).toEqual(rentalScope());
    expect(parseRentalCommandPageQuery({customerId:rentalId(2),projectName:'A'})).toEqual({ customerId:rentalId(2),projectName:'A',contractId:null });
    for (const query of ['&eventPage=-1','&plotPage=100001','&contractPage=01','&projectName=B','&token=x']) {
      expect(() => parseRentalCommandQuery(`https://test.invalid/?customerId=${rentalId(2)}&projectName=A&contractId=${rentalId(1)}${query}`)).toThrow();
    }
    expect(() => parseRentalCommandScope({...rentalScope(),contractId:null,eventPage:1})).toThrow();
    expect(() => parseRentalCommandPageQuery({customerId:[rentalId(2)],projectName:'A'})).toThrow();
  });
  it('snapshot keeps unpaid savings/deposit zero and validates every relation', () => {
    const snapshot = rentalSnapshot(); expect(parseRentalCommandSnapshot(snapshot,rentalScope())).toEqual(snapshot);
    expect(snapshot.selectedContract?.confirmedSavingsSatang).toBe(0); expect(snapshot.selectedContract?.confirmedDepositSatang).toBe(0);
    for (const patch of [{customerId:rentalId(90)}, {interestId:rentalId(90)}, {projectName:'B'}, {ownerUserId:rentalId(90)},
      {endDate:'2025-12-01'}, {status:'converted'}, {status:'ended'}, {confirmedSavingsSatang:999999999999}]) {
      expect(() => parseRentalCommandSnapshot({...snapshot,selectedContract:{...snapshot.selectedContract,...patch}},rentalScope())).toThrow();
    }
  });
  it('cannot expose cross-contract payments, duplicate rows or unsafe edit authority', () => {
    const snapshot = rentalSnapshot();
    expect(() => parseRentalCommandSnapshot({...snapshot,contracts:[...snapshot.contracts,...snapshot.contracts]},rentalScope())).toThrow();
    expect(() => parseRentalCommandSnapshot({...snapshot,actor:{...snapshot.actor,role:'owner'}},rentalScope())).toThrow();
    expect(() => parseRentalCommandSnapshot({...snapshot,interest:{...snapshot.interest,ownerUserId:rentalId(90)}},rentalScope())).toThrow();
    expect(() => parseRentalCommandSnapshot({...snapshot,eventPage:1},rentalScope())).toThrow();
    expect(() => parseRentalCommandSnapshot({...snapshot,payments:[{id:rentalId(20),contractId:rentalId(90),kind:'savings',amountSatang:1,paidDate:'2026-10-09',
      reference:'R-1',evidenceNote:'receipt',recordedAt:'2026-10-09T00:00:00Z',actorUserId:rentalId(6)}]},rentalScope())).toThrow();
  });
  it('accepts read-only Owner without false edit permissions', () => {
    const snapshot=rentalSnapshot(); snapshot.actor.role='owner'; snapshot.interest.canEdit=false;
    expect(parseRentalCommandSnapshot(snapshot,rentalScope()).interest.canEdit).toBe(false);
  });
  it('accepts only a matching successful receipt with a changed contract revision', () => {
    expect(parseRentalCommandResult(rentalResult(),rentalInput())).toEqual(rentalResult());
    for(const patch of [{requestId:rentalId(90)},{customerId:rentalId(90)},{interestId:rentalId(90)},{contractId:rentalId(90)},
      {contractRevision:rentalId(3)},{saleId:rentalId(90)},{saleRevision:rentalId(90)},{command:'start'}]) {
      expect(() => parseRentalCommandResult({...rentalResult(),...patch},rentalInput())).toThrow();
    }
    const input=parseRentalCommandInput(conversion());
    expect(parseRentalCommandResult(rentalResult(input),input).saleId).toBeTruthy();
    expect(() => parseRentalCommandResult({...rentalResult(input),saleRevision:null},input)).toThrow();
  });
});

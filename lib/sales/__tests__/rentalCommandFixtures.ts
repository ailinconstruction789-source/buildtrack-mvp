import type { RentalCommandInput, RentalCommandResult, RentalCommandScope, RentalCommandSnapshot, CanonicalRentalContract } from '../rentalCommandContracts';
import { pbid } from './postBookingFixtures';
export { pbid as rentalId };
export const rentalScope = (): RentalCommandScope => ({ customerId: pbid(2), projectName: 'A', contractId: pbid(1), contractPage: 0, eventPage: 0, paymentPage: 0, plotPage: 0 });
export function rentalContract(): CanonicalRentalContract {
  return { id: pbid(1), customerId: pbid(2), interestId: pbid(5), ownerUserId: pbid(6), projectName: 'A', plotId: 'A1', programType: 'program_b',
    status: 'active', revision: pbid(3), startDate: '2026-01-31', endDate: '2027-01-30', monthlyRentSatang: 1500000,
    securityDepositSatang: 3000000, advanceRentSatang: 1500000, savingsPerMonthSatang: 500000, basePriceSatang: 250000000,
    confirmedSavingsSatang: 0, confirmedDepositSatang: 0, convertedSaleId: null, endedDate: null };
}
export function rentalSnapshot(): RentalCommandSnapshot {
  return { actor: { userId: pbid(6), role: 'sales' }, customer: { id: pbid(2), name: 'Customer', phone: null, revision: pbid(7) },
    interest: { id: pbid(5), projectName: 'A', ownerUserId: pbid(6), revision: pbid(4), canEdit: true }, contracts: [rentalContract()],
    contractPage: 0, contractsHasMore: false, selectedContract: rentalContract(), events: [], eventPage: 0, eventsHasMore: false,
    payments: [], paymentPage: 0, paymentsHasMore: false, plots: [{ id: 'A2', name: 'แปลง 2', available: true }], plotPage: 0, plotsHasMore: false };
}
export const rentalInput = (): RentalCommandInput => ({ requestId: pbid(8), command: 'renew', customerId: pbid(2), interestId: pbid(5), projectName: 'A',
  expectedCustomerRevision: pbid(7), expectedInterestRevision: pbid(4), contractId: pbid(1), expectedContractRevision: pbid(3), reason: 'ลูกค้าต่อสัญญา', renewalMonths: 12, monthlyRentSatang: 1600000 });
export function rentalResult(input = rentalInput(), replayed = false): RentalCommandResult {
  return { requestId: input.requestId, command: input.command, customerId: input.customerId, interestId: input.interestId, contractId: input.contractId ?? pbid(1),
    contractRevision: pbid(80), interestRevision: pbid(81), saleId: input.command === 'convert_to_buy' ? pbid(82) : null,
    saleRevision: input.command === 'convert_to_buy' ? pbid(83) : null, replayed };
}

import type { CustomerDealEditInput, CustomerDealEditResult, CustomerDealEditSnapshot } from '../customerDealEditContracts';
import { pbid } from './postBookingFixtures';
export { pbid as editId };
export const editScope = () => ({ saleId: pbid(1), projectName: 'A' });
export function editSnapshot(): CustomerDealEditSnapshot {
  return { actor: { userId: pbid(6), role: 'sales' },
    customer: { id: pbid(2), name: 'Customer', phone: null, occupation: null, ownerUserId: pbid(6), revision: pbid(7), detailsRevision: null,
      canEdit: true, sourceName: 'Original customer', sourcePhone: null },
    deal: { id: pbid(1), customerId: pbid(2), interestId: pbid(5), ownerUserId: pbid(6), projectName: 'A', plotId: 'A1', stage: 'booked',
      revision: pbid(3), interestRevision: pbid(4), detailsRevision: null, salePrice: 2500000, sourceSalePrice: 2500000,
      bankName: null, sourceBankName: null, paymentMethod: 'mortgage', canEdit: true } };
}
export function editInput(): CustomerDealEditInput {
  return { requestId: pbid(8), command: 'update_details', customerId: pbid(2), ...editScope(), expectedCustomerRevision: pbid(7),
    expectedInterestRevision: pbid(4), expectedSaleRevision: pbid(3), expectedCustomerDetailsRevision: null, expectedDealDetailsRevision: null,
    reason: 'ลูกค้ายืนยันข้อมูลใหม่', profile: { name: 'Current customer', phone: null, occupation: null }, dealDetails: { salePriceSatang: 265000000, bankName: 'กสิกรไทย' } };
}
export function editResult(input = editInput(), replayed = false): CustomerDealEditResult {
  return { requestId: input.requestId, command: input.command, customerId: input.customerId, interestId: pbid(5), saleId: input.saleId,
    customerRevision: input.expectedCustomerRevision, interestRevision: input.expectedInterestRevision, saleRevision: input.expectedSaleRevision,
    customerDetailsRevision: input.profile ? pbid(80) : input.expectedCustomerDetailsRevision,
    dealDetailsRevision: input.dealDetails ? pbid(81) : input.expectedDealDetailsRevision, replayed };
}

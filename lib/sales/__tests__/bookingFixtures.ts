import type { BookingContext, BookingInput, BookingResult } from '../bookingContracts';
export const bid = (number: number) => `18000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
export function bookingInput(): BookingInput {
  return { requestId: bid(1), command: 'book', customerId: bid(2), newCustomer: null, projectName: 'โครงการ A', expectedInterestRevision: bid(4), plotId: 'A-01',
    paymentMethod: 'mortgage', bookingRoute: 'without_visit', visitId: null, listPriceSatang: 250000000, discountSatang: 100000, depositSatang: 500000, previousSaleId: null, reason: 'ลูกค้ายืนยันจองทางโทรศัพท์' };
}
export function bookingResult(): BookingResult {
  return { command: 'book', customerId: bid(2), interestId: bid(3), saleId: bid(5), saleRevision: bid(6), interestRevision: bid(7), nextActionId: null, replayed: false };
}
export function bookingContext(): BookingContext {
  return { actor: { userId: bid(8), role: 'sales' }, customer: { id: bid(2), name: 'ลูกค้าทดสอบ', phone: null, ownerUserId: bid(8), revision: bid(9) },
    projects: [{ name: 'โครงการ A' }], salesOwners: [{ userId: bid(8), displayName: 'Sales A' }],
    interests: [{ id: bid(3), projectName: 'โครงการ A', ownerUserId: bid(8), revision: bid(4), status: 'follow_up', currentActionId: null, canEdit: true, visits: [] }],
    sales: [{ id: bid(5), interestId: bid(3), projectName: 'โครงการ A', plotId: 'A-01', stage: 'cancelled', revision: bid(6), bookingRound: 1, previousSaleId: null,
      bookedAt: null, cancelledAt: null, cancellationReason: null, cancellationCategory: null, listPrice: null, discountAmount: null, salePrice: null, depositAmount: null, paymentMethod: null, canCancel: false, canResume: true }], page: 0, hasMore: false };
}

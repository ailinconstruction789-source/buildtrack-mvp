import type { BookingContext, BookingInput, BookingResult } from '@/lib/sales/bookingContracts';
export const actorId = '00000000-0000-4000-8000-000000000001';
export const customerId = '00000000-0000-4000-8000-000000000002';
export const interestId = '00000000-0000-4000-8000-000000000003';
export const revisionId = '00000000-0000-4000-8000-000000000004';
export const saleId = '00000000-0000-4000-8000-000000000005';
export const otherSaleId = '00000000-0000-4000-8000-000000000006';
export function bookingContext(customer = true): BookingContext {
  return { actor: { userId: actorId, role: 'sales' }, customer: customer ? { id: customerId, name: 'ลูกค้าเดิม', phone: '0000000000', ownerUserId: actorId, revision: revisionId } : null,
    projects: [{ name: 'A' }, { name: 'B' }], salesOwners: [{ userId: actorId, displayName: 'Sales A' }],
    interests: customer ? [{ id: interestId, projectName: 'A', ownerUserId: actorId, revision: revisionId, status: 'following_up', currentActionId: null, canEdit: true,
      visits: [{ id: otherSaleId, checkedInAt: '2026-09-20T09:00:00+07:00' }] }] : [],
    sales: customer ? [{ id: saleId, interestId, projectName: 'A', plotId: null, stage: 'cancelled', revision: revisionId,
      bookingRound: 1, previousSaleId: null, bookedAt: null, cancelledAt: null, cancellationReason: 'ยกเลิกเก่า', cancellationCategory: 'booking_cancelled',
      listPrice: null, discountAmount: null, salePrice: null, depositAmount: null, paymentMethod: null, canCancel: false, canResume: true },
    { id: otherSaleId, interestId, projectName: 'A', plotId: 'A-2', stage: 'booked', revision: revisionId,
      bookingRound: 2, previousSaleId: saleId, bookedAt: '2026-09-21T09:00:00+07:00', cancelledAt: null, cancellationReason: null, cancellationCategory: null,
      listPrice: 2000000, discountAmount: 10000, salePrice: 1990000, depositAmount: 5000, paymentMethod: 'mortgage', canCancel: true, canResume: false }] : [], page: 0, hasMore: false };
}
export const cancelInput: BookingInput = { command: 'cancel', requestId: '00000000-0000-4000-8000-000000000007', reason: 'ลูกค้าขอยกเลิก', customerId, saleId: otherSaleId, expectedSaleRevision: revisionId, cancellationCategory: 'booking_cancelled' };
export const bookingResult = (command: BookingInput['command'] = 'cancel'): BookingResult => ({ command, customerId, saleId: otherSaleId, interestId, saleRevision: revisionId, interestRevision: revisionId, nextActionId: command === 'resume_follow_up' ? saleId : null, replayed: false });

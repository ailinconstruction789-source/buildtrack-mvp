import { describe, expect, it } from 'vitest';
import { canStartSalesDeal, getLeadStage, preserveLeadDealStage } from '../sales/leadStage';
import { bangkokToday, isDueSalesLead, isUpcomingSalesLead } from '../sales/actionFilters';
import { salesDealStageOf } from '../sales/dealStatus';
import { isCancelledBookingLead, isPreBookingLost } from '../sales/leadLifecycle';
import { mapCRMStatusToLegacyStatus, mapToCRMStatus } from '../salesImportHelper';

describe('shared Sales deal state', () => {
  it.each(['Lost', 'Cancelled', 'Closed_Lost', 'MovedOut'])('%s wins over old booking history', status => {
    const lead = { status, notes: '🏷️ บันทึกการจอง', booking_date: '2026-01-01' };
    expect(getLeadStage(lead)).toBe('lost'); expect(canStartSalesDeal(lead)).toBe(false);
  });
  it.each(['Transferred', 'Handover', 'Closed_Won'])('%s remains transferred with old booking history', status => {
    expect(getLeadStage({ status, notes: '🏷️ บันทึกการจอง' })).toBe('transferred');
  });
  it.each(['Booked', 'Transferred', 'Rented', 'Lost', 'Loan'])('activity cannot overwrite %s', status => {
    const patch = { status: 'Visit', crm_status: 'Considering', notes: 'activity' };
    expect(preserveLeadDealStage({ status }, patch)).toEqual({ notes: 'activity' });
    expect(patch.status).toBe('Visit');
  });
  it('recognizes protected CRM state even when status still says Visit', () => {
    expect(getLeadStage({ status: 'Visit', crm_status: 'Booked — จองแล้ว' })).toBe('booked');
  });
  it.each(['DownPayment', 'DocumentPrep', 'LoanProcessing', 'Approved', 'Transfer Pending'])('native %s is already post-booking', status => {
    expect(getLeadStage({ status })).toBe('booked'); expect(canStartSalesDeal({ status })).toBe(false);
  });
  it.each([['DownPayment', 'downpayment'], ['DocumentPrep', 'document_prep'], ['LoanProcessing', 'loan_submitted'], ['Approved', 'loan_approved']])('opens native %s at its actual progress step', (status, expected) => {
    expect(salesDealStageOf({ status })).toBe(expected);
  });
  it('keeps an explicitly reactivated customer active without erasing old history', () => {
    expect(getLeadStage({ status: 'Follow Up', crm_status: 'Follow Up', notes: '🏷️ บันทึกการจอง', booking_date: '2026-01-01' })).toBe('active');
  });
  it('still recognizes a legacy booking with no structured status', () => {
    expect(getLeadStage({ notes: '🏷️ บันทึกการจอง' })).toBe('booked');
  });
  it('uses Bangkok day boundaries', () => { expect(bangkokToday(new Date('2026-10-08T23:00:00Z'))).toBe('2026-10-09'); });
  it('due actions include active, visit and loan but exclude booked customers', () => {
    for (const status of ['Active', 'Visit', 'Loan']) expect(isDueSalesLead({ status, appointment_date: '2026-10-08' }, '2026-10-09')).toBe(true);
    expect(isDueSalesLead({ status: 'Booked', appointment_date: '2026-10-08' }, '2026-10-09')).toBe(false);
  });
  it('upcoming uses appointment date rather than stage name', () => {
    expect(isUpcomingSalesLead({ status: 'Active', appointment_date: '2026-10-10' }, '2026-10-09')).toBe(true);
    expect(isUpcomingSalesLead({ status: 'Visit', appointment_date: '2026-10-08' }, '2026-10-09')).toBe(false);
  });
  it('separates cancelled bookings from pre-booking lost leads', () => {
    const cancelledBooking = { status: 'Cancelled', crm_status: 'Cancelled — ยกเลิกจอง', auto_status: 'ยกเลิกจอง', booking_date: '2026-01-10' };
    const preBookingLost1 = { status: 'Lost', crm_status: 'Lost — ยุติการซื้อ / ไม่จอง', auto_status: 'ยุติการซื้อ' };
    const preBookingLost2 = { status: 'Lost', crm_status: 'Lost — ไม่สนใจ / ยุติการติดตาม' };
    const unqualified = { status: 'Unqualified', crm_status: 'Unqualified (ไม่สนใจ / ยกเลิกติดตาม)' };

    expect(isCancelledBookingLead(cancelledBooking)).toBe(true);
    expect(isPreBookingLost(cancelledBooking)).toBe(false);

    expect(isCancelledBookingLead(preBookingLost1)).toBe(false);
    expect(isPreBookingLost(preBookingLost1)).toBe(true);

    expect(isCancelledBookingLead(preBookingLost2)).toBe(false);
    expect(isPreBookingLost(preBookingLost2)).toBe(true);

    expect(isCancelledBookingLead(unqualified)).toBe(false);
    expect(isPreBookingLost(unqualified)).toBe(true);

    expect(mapToCRMStatus('ยกเลิกจอง')).toBe('Cancelled — ยกเลิกจอง');
    expect(mapToCRMStatus('หลุดจอง')).toBe('Cancelled — ยกเลิกจอง');
    expect(mapCRMStatusToLegacyStatus('Cancelled — ยกเลิกจอง')).toBe('Cancelled');

    expect(mapToCRMStatus('ยุติการซื้อ')).toBe('Lost — ยุติการซื้อ / ไม่จอง');
    expect(mapToCRMStatus('ไม่สนใจ')).toBe('Lost — ยุติการซื้อ / ไม่จอง');
    expect(mapCRMStatusToLegacyStatus('Lost — ยุติการซื้อ / ไม่จอง')).toBe('Lost');
  });
});

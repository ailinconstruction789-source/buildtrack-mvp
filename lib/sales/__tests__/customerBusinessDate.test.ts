import { describe, expect, it } from 'vitest';
import { customerActualTransferDay, customerBusinessDay, customerExpectedTransferDay, customerOperationalYear } from '../customerBusinessDate';
describe('customer business date and year', () => {
  it('separates expected and actual dates, retaining unknown actual history', () => {
    expect(customerExpectedTransferDay({ expected_transfer_date: '2026-10-30' })).toBe('2026-10-30');
    expect(customerExpectedTransferDay({ expected_transfer_date: null })).toBeNull();
    expect(customerActualTransferDay({ transferredDate: null, history: [] })).toBeNull();
    expect(customerActualTransferDay({ transferredDate: '2024-01-01', history: [{ status: 'Transferred', timestamp: '2023-01-01' }] })).toBe('2024-01-01');
    expect(customerActualTransferDay({ history: [{ status: 'Transferred', timestamp: '2025-12-31T18:00:00Z' }] })).toBe('2026-01-01');
  });
  it('keeps an explicitly unknown normalized forecast instead of falling through to stale aliases', () => {
    expect(customerExpectedTransferDay({ expectedTransferDate: null, expected_transfer_date: '2026-10-30' })).toBeNull();
    expect(customerExpectedTransferDay({ expectedTransfer: null, expectedTransferDate: '2026-10-30' })).toBeNull();
    expect(customerExpectedTransferDay({ expectedTransferDate: '2026-10-30' })).toBe('2026-10-30');
    expect(customerExpectedTransferDay({ expectedTransfer: '2026-02-30' })).toBeNull();
  });
  it('keeps an old CRM customer year unknown instead of using import time', () => {
    expect(customerOperationalYear({ sourceKind: 'sale', created_at: '2026-10-09T12:00:00Z', updated_at: '2026-10-10T12:00:00Z' })).toBeNull();
    expect(customerOperationalYear({ saleId: 'fixture', created_at: '2026-10-09T12:00:00Z' })).toBeNull();
    expect(customerOperationalYear({ status: 'Booked', created_at: '2026-10-09T12:00:00Z' })).toBeNull();
    expect(customerOperationalYear({ sourceKind: 'crm', created_at: '2026-10-09T12:00:00Z' })).toBeNull();
    expect(customerOperationalYear(null)).toBeNull();
  });
  it('uses real transfer/booking/source dates and Bangkok year boundaries', () => {
    expect(customerOperationalYear({ sourceKind: 'sale', booking_date: '2024-01-01', transferred_date: '2025-01-01' })).toBe(2025);
    expect(customerOperationalYear({ sourceKind: 'sale', importedHistory: { bookedDate: '2023-02-01' } })).toBe(2023);
    expect(customerOperationalYear({ sourceKind: 'rental', rental_start_date: '2025-03-01', created_at: '2026-01-01' })).toBe(2025);
    expect(customerBusinessDay('2025-12-31T18:00:00Z')).toBe('2026-01-01');
  });
  it('can use actual native intake metadata without treating updates as new intake', () => {
    expect(customerOperationalYear({ created_at: '2024-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' })).toBe(2024);
    expect(customerOperationalYear({ updated_at: '2026-01-01T00:00:00Z' })).toBeNull();
  });
  it.each(['2026-02-30','0000-01-01','2026-01-01T00:00:00','not a date'])('rejects malformed evidence %s', value => {
    expect(customerBusinessDay(value)).toBeNull();
  });
});

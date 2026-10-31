import { describe, expect, it } from 'vitest';
import { customerDealDetails, customerDealSummary, extractAgreedPrices, extractExpectedTransferDate, updateExpectedTransferDateInNotes } from '../customerDealDetails';
describe('customer deal history values', () => {
  it('reads the latest customer-specific price and bank ahead of older booking history', () => {
    const notes = customerDealSummary(2650000, 'New bank') + '\n\n' + customerDealSummary(2793000, 'Old bank');
    expect(customerDealDetails(notes)).toEqual({ salePrice: 2650000, bank: 'New bank' });
  });
  it('preserves zero and an explicitly cleared bank', () => {
    expect(customerDealDetails(customerDealSummary(0, '') + '\n' + customerDealSummary(100, 'Old bank'))).toEqual({ salePrice: 0, bank: '' });
  });
  it('reads existing booking summary labels without requiring a schema change', () => {
    expect(customerDealDetails('🏷️ บันทึกการจอง\n• ราคาขายสุทธิ: ฿2,793,000 บาท\n• เงินจองที่รับ: ฿10,000 บาท')).toEqual({ salePrice: 2793000, bank: '' });
  });
  it('does not treat deposit, catalogue price or an arbitrary number as a sale price', () => {
    expect(customerDealDetails('• ราคาก่อนส่วนลด: ฿2,900,000 บาท\n• เงินจองที่รับ: ฿10,000 บาท')).toEqual({ salePrice: null, bank: '' });
  });
  describe('extractAgreedPrices', () => {
    it('extracts net sale price from structured deal summary', () => {
      const notes = '• ราคาขายสุทธิ: ฿2,793,000 บาท\n• ธนาคาร: SCB';
      expect(extractAgreedPrices(notes)).toEqual({ salePrice: 2793000, landAppraisalPrice: null });
    });
    it('extracts agreed price and land office price from notes string', () => {
      const notes = 'เช่าซื้อ, ซื้อพร้อมผู้เช่า · ที่ดิน 53.9 ตร.ว. · ราคา: 4,657,000 บ. · คาดโอน: ต.ค. 2569';
      expect(extractAgreedPrices(notes)).toEqual({ salePrice: 4657000, landAppraisalPrice: null });
    });
    it('extracts both agreed price and land office appraisal price', () => {
      const notes = 'ที่ดิน 72.6 ตร.ว. · ราคา: 2,690,000 บ. · ราคาทด13: 2,999,000 บ.';
      expect(extractAgreedPrices(notes)).toEqual({ salePrice: 2690000, landAppraisalPrice: 2999000 });
    });
    it('extracts land office price formatted as ราคา ท.ด. ฿2,950,000 or ยอด ทด or in deal summary', () => {
      expect(extractAgreedPrices('• ราคาขายสุทธิ: ฿2,500,000 บาท\n• ราคา ทด.13: ฿2,800,000 บาท\n• ธนาคาร: SCB')).toEqual({
        salePrice: 2500000,
        landAppraisalPrice: 2800000
      });
      expect(extractAgreedPrices('ราคา ท.ด. ฿2,950,000')).toEqual({
        salePrice: null,
        landAppraisalPrice: 2950000
      });
      expect(extractAgreedPrices('ยอด ทด: 3,100,000 บาท')).toEqual({
        salePrice: null,
        landAppraisalPrice: 3100000
      });
    });
    it('handles empty or non-string input safely', () => {
      expect(extractAgreedPrices(null)).toEqual({ salePrice: null, landAppraisalPrice: null });
      expect(extractAgreedPrices('')).toEqual({ salePrice: null, landAppraisalPrice: null });
    });
  });
  describe('extractExpectedTransferDate', () => {
    it('extracts expected transfer date with Thai month and BE year', () => {
      const notes = 'เช่าซื้อ, ซื้อพร้อมผู้เช่า · ที่ดิน 53.9 ตร.ว. · ราคา: 4,657,000 บ. · คาดโอน: ต.ค. 2569';
      expect(extractExpectedTransferDate(notes)).toBe('2026-10-31');
    });
    it('extracts specific expected transfer date with day', () => {
      const notes = '• คาดโอน: 15/10/2569';
      expect(extractExpectedTransferDate(notes)).toBe('2026-10-15');
    });
    it('returns null when no expected transfer date is present', () => {
      expect(extractExpectedTransferDate('ไม่มีข้อมูล')).toBeNull();
      expect(extractExpectedTransferDate(null)).toBeNull();
    });
  });
  describe('updateExpectedTransferDateInNotes', () => {
    it('appends expected transfer date when notes has no prior date', () => {
      const notes = '• ราคาขายสุทธิ: ฿2,793,000 บาท\n• ธนาคาร: SCB';
      const updated = updateExpectedTransferDateInNotes(notes, '2026-11-15');
      expect(updated).toBe('• ราคาขายสุทธิ: ฿2,793,000 บาท\n• ธนาคาร: SCB\n• คาดโอน: 2026-11-15');
      expect(extractExpectedTransferDate(updated)).toBe('2026-11-15');
    });
    it('replaces existing expected transfer date in line format', () => {
      const notes = '• ราคาขายสุทธิ: ฿2,793,000 บาท\n• คาดโอน: 2026-10-15';
      const updated = updateExpectedTransferDateInNotes(notes, '2026-12-01');
      expect(updated).toBe('• ราคาขายสุทธิ: ฿2,793,000 บาท\n• คาดโอน: 2026-12-01');
      expect(extractExpectedTransferDate(updated)).toBe('2026-12-01');
    });
    it('replaces existing expected transfer date in dot format', () => {
      const notes = 'เช่าซื้อ · ราคา: 4,657,000 บ. · คาดโอน: ต.ค. 2569';
      const updated = updateExpectedTransferDateInNotes(notes, '2026-11-20');
      expect(updated).toBe('เช่าซื้อ · ราคา: 4,657,000 บ. · คาดโอน: 2026-11-20');
      expect(extractExpectedTransferDate(updated)).toBe('2026-11-20');
    });
    it('clears expected transfer date when newDateStr is null', () => {
      const notes = '• ราคาขายสุทธิ: ฿2,793,000 บาท\n• คาดโอน: 2026-10-15';
      const updated = updateExpectedTransferDateInNotes(notes, null);
      expect(updated).toBe('• ราคาขายสุทธิ: ฿2,793,000 บาท');
      expect(extractExpectedTransferDate(updated)).toBeNull();
    });
  });
});


import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { formatThaiBahtText, generateReceiptNumber } from '@/lib/rentalHelper';
import RentalReceiptModal from '../RentalReceiptModal';
import { RentalReceiptData } from '@/types/sales';

describe('Ailin Rental Advanced Features & Helper Tests', () => {

  describe('formatThaiBahtText (แปลงตัวเลขเป็นตัวอักษรภาษาไทย)', () => {
    it('correctly converts basic thousands and tens of thousands', () => {
      expect(formatThaiBahtText(15000)).toBe('หนึ่งหมื่นห้าพันบาทถ้วน');
      expect(formatThaiBahtText(30000)).toBe('สามหมื่นบาทถ้วน');
      expect(formatThaiBahtText(5000)).toBe('ห้าพันบาทถ้วน');
    });

    it('correctly converts millions and complex numbers', () => {
      expect(formatThaiBahtText(2990000)).toBe('สองล้านเก้าแสนเก้าหมื่นบาทถ้วน');
      expect(formatThaiBahtText(1000000)).toBe('หนึ่งล้านบาทถ้วน');
      expect(formatThaiBahtText(100000)).toBe('หนึ่งแสนบาทถ้วน');
    });

    it('handles zero and edge cases', () => {
      expect(formatThaiBahtText(0)).toBe('ศูนย์บาทถ้วน');
      expect(formatThaiBahtText(NaN)).toBe('ศูนย์บาทถ้วน');
    });

    it('handles satangs correctly', () => {
      expect(formatThaiBahtText(15000.50)).toBe('หนึ่งหมื่นห้าพันบาทห้าสิบสตางค์');
      expect(formatThaiBahtText(15000.25)).toBe('หนึ่งหมื่นห้าพันบาทยี่สิบห้าสตางค์');
    });
  });

  describe('generateReceiptNumber', () => {
    it('generates properly formatted receipt and invoice numbers', () => {
      const rcp = generateReceiptNumber('receipt', 1, '32');
      expect(rcp).toMatch(/^RCP-\d{6}-P32-M01$/);

      const inv = generateReceiptNumber('invoice', 5, '08');
      expect(inv).toMatch(/^INV-\d{6}-P08-M05$/);
    });
  });

  describe('RentalReceiptModal Component', () => {
    const mockData: RentalReceiptData = {
      receiptNo: 'RCP-202610-P32-M01',
      receiptType: 'receipt',
      issueDate: '2026-10-05',
      dueDate: '2026-10-05',
      projectName: 'ไอลิน สันทราย 2',
      plotName: '32',
      tenantName: 'คุณสมชาย ใจดี',
      tenantPhone: '081-234-5678',
      periodLabel: 'งวดที่ 1 (ต.ค. 2569)',
      programName: 'Rent to Own (เช่าซื้อ)',
      programCode: 'B',
      rentAmount: 15000,
      savingsAmount: 5000,
      totalAmount: 15000,
      paidAmount: 15000,
      paymentMethod: 'transfer',
      paymentStatus: 'Paid',
      companyName: 'ไอลิน พร็อพเพอร์ตี้',
      promptPayId: '0812345678',
      agentName: 'ทีมขายไอลิน'
    };

    it('renders receipt modal with tenant, plot, and Thai Baht text', () => {
      render(
        <RentalReceiptModal
          isOpen={true}
          onClose={vi.fn()}
          data={mockData}
        />
      );

      expect(screen.getAllByText('คุณสมชาย ใจดี').length).toBeGreaterThan(0);
      expect(screen.getAllByText(/RCP-202610-P32-M01/).length).toBeGreaterThan(0);
      expect(screen.getByText(/หนึ่งหมื่นห้าพันบาทถ้วน/)).toBeDefined();
    });
  });

});

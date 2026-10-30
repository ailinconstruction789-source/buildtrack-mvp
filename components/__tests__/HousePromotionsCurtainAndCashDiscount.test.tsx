import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import HousePromotionsView, { isCashDiscountPromo, getCashDiscountAmount } from '../HousePromotionsView';

const dbMocks = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  in: vi.fn(),
  eq: vi.fn(),
  delete: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn()
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: dbMocks.from
  }
}));

describe('HousePromotionsView - Curtain & Cash Discount Features', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    dbMocks.from.mockReturnValue({
      select: dbMocks.select,
      delete: dbMocks.delete,
      insert: dbMocks.insert,
      update: dbMocks.update,
      upsert: dbMocks.upsert
    });

    dbMocks.select.mockReturnValue({
      in: dbMocks.in,
      eq: dbMocks.eq
    });

    dbMocks.in.mockResolvedValue({ data: [], error: null });
    dbMocks.eq.mockResolvedValue({ data: [], error: null });
    dbMocks.delete.mockReturnValue({
      eq: dbMocks.eq,
      in: dbMocks.in
    });
    dbMocks.insert.mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [], error: null })
    });
    dbMocks.upsert.mockResolvedValue({ error: null });
  });

  describe('Helper functions: isCashDiscountPromo & getCashDiscountAmount', () => {
    it('detects cash discount by category or item_name', () => {
      expect(isCashDiscountPromo({ category: 'เปลี่ยนเป็นเงินสด' })).toBe(true);
      expect(isCashDiscountPromo({ category: 'cash_discount' })).toBe(true);
      expect(isCashDiscountPromo({ item_name: 'ไม่รับของแถม เปลี่ยนเป็นส่วนลดเงินสด' })).toBe(true);
      expect(isCashDiscountPromo({ category: 'ห้องโถง / Living Room', item_name: 'ผ้าม่านกัน UV ทั้งหลัง' })).toBe(false);
    });

    it('extracts cash discount amount from remarks', () => {
      expect(getCashDiscountAmount({ remarks: '50000' })).toBe(50000);
      expect(getCashDiscountAmount({ remarks: '50,000 บาท' })).toBe(50000);
      expect(getCashDiscountAmount({ remarks: null })).toBe(0);
      expect(getCashDiscountAmount(null)).toBe(0);
    });
  });

  describe('Matrix Overview: Curtains & Dark Gray Cash Discount Row', () => {
    const mockPlots = [
      { id: 'AL6-01', project_name: 'The Valley', house_types: { type_name: 'Villa A' } },
      { id: 'AL6-02', project_name: 'The Valley', house_types: { type_name: 'Villa B' } }
    ];

    it('renders "ผ้าม่านกัน UV ทั้งหลัง" column header and displays dark gray row for cash discount', async () => {
      // Mock AL6-01 with freebies (including curtains), AL6-02 with cash discount
      const mockPromotions = [
        {
          id: 'p-1',
          plot_id: 'AL6-01',
          category: 'ห้องโถง / Living Room',
          item_name: 'ผ้าม่านกัน UV ทั้งหลัง',
          quantity: 1,
          status: 'installed'
        },
        {
          id: 'p-2',
          plot_id: 'AL6-02',
          category: 'เปลี่ยนเป็นเงินสด',
          item_name: 'ไม่รับของแถม เปลี่ยนเป็นส่วนลดเงินสด',
          quantity: 1,
          status: 'installed',
          remarks: '50000'
        }
      ];

      dbMocks.in.mockResolvedValue({ data: mockPromotions, error: null });

      render(
        <HousePromotionsView
          plots={mockPlots}
          projects={[{ name: 'The Valley' }]}
          currentUserRole="Admin"
        />
      );

      // Verify "ทั้งหลัง" and "ผ้าม่านกัน UV ทั้งหลัง" header columns exist
      await waitFor(() => {
        expect(screen.getByText('ทั้งหลัง')).toBeInTheDocument();
        expect(screen.getByText('ผ้าม่านกัน UV ทั้งหลัง')).toBeInTheDocument();
      });

      // Verify AL6-02 displays the cash discount text and dark gray row styling
      await waitFor(() => {
        expect(screen.getByText(/เปลี่ยนเป็นเงินสด ฿50,000 บาท/)).toBeInTheDocument();
        expect(screen.getByText('(แปลงนี้ไม่รับของแถมทุกรายการ — เปลี่ยนเป็นส่วนลดเงินสด)')).toBeInTheDocument();
      });

      // AL6-01 shows normal installation status for curtains
      expect(screen.getByText('🟢 ติดตั้งแล้ว')).toBeInTheDocument();
    });
  });

  describe('Single Plot View: Selected Freebies Summary & Cash Discount Switcher', () => {
    const mockPlot = { id: 'AL6-01', project_name: 'The Valley', house_types: { type_name: 'Villa A' } };

    it('displays summary of selected items for this house', async () => {
      const mockPromotions = [
        {
          id: 'p-1',
          plot_id: 'AL6-01',
          category: 'ห้องโถง / Living Room',
          item_name: 'ผ้าม่านกัน UV ทั้งหลัง',
          quantity: 1,
          status: 'installed'
        },
        {
          id: 'p-2',
          plot_id: 'AL6-01',
          category: 'เครื่องใช้ไฟฟ้า',
          item_name: 'แอร์ 18,000 BTU',
          quantity: 1,
          status: 'pending'
        }
      ];

      dbMocks.in.mockResolvedValue({ data: mockPromotions, error: null });

      render(
        <HousePromotionsView
          plots={[mockPlot]}
          selectedPlot={mockPlot}
          projects={[{ name: 'The Valley' }]}
          currentUserRole="Admin"
        />
      );

      // Switch to single plot view
      await waitFor(() => {
        expect(screen.getByText(/รายหลัง/)).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText(/รายหลัง/));

      // Verify summary of selected items is shown
      await waitFor(() => {
        expect(screen.getByText(/รายการของแถมที่แปลง AL6-01 เลือก/)).toBeInTheDocument();
        expect(screen.getAllByText('ผ้าม่านกัน UV ทั้งหลัง').length).toBeGreaterThan(0);
        expect(screen.getAllByText('แอร์ 18,000 BTU').length).toBeGreaterThan(0);
      });
    });

    it('allows entering and saving cash discount, turning the plot into cash discount mode', async () => {
      dbMocks.in.mockResolvedValue({ data: [], error: null });

      render(
        <HousePromotionsView
          plots={[mockPlot]}
          selectedPlot={mockPlot}
          projects={[{ name: 'The Valley' }]}
          currentUserRole="Admin"
        />
      );

      // Switch to single plot view
      await waitFor(() => {
        expect(screen.getByText(/รายหลัง/)).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText(/รายหลัง/));

      // Click "เปลี่ยนเป็นเงินสด"
      await waitFor(() => {
        expect(screen.getByText('เปลี่ยนเป็นเงินสด')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('เปลี่ยนเป็นเงินสด'));

      // Fill cash discount amount
      await waitFor(() => {
        expect(screen.getByPlaceholderText('เช่น 50000')).toBeInTheDocument();
      });
      const input = screen.getByPlaceholderText('เช่น 50000');
      fireEvent.change(input, { target: { value: '75000' } });

      // Click "ยืนยันเปลี่ยนเป็นเงินสด"
      const saveBtn = screen.getByText('ยืนยันเปลี่ยนเป็นเงินสด');
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(dbMocks.delete).toHaveBeenCalled();
        expect(dbMocks.insert).toHaveBeenCalledWith(expect.arrayContaining([
          expect.objectContaining({
            plot_id: 'AL6-01',
            category: 'เปลี่ยนเป็นเงินสด',
            item_name: 'ไม่รับของแถม เปลี่ยนเป็นส่วนลดเงินสด',
            remarks: '75000'
          })
        ]));
      });
    });
  });
});

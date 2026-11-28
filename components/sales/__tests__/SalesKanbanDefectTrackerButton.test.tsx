import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SalesDefectTrackerModal, { fetchPlotDefectTrackerData } from '../SalesDefectTrackerModal';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  readAll: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mocks.from,
  },
}));

vi.mock('@/lib/sales/fetchWithoutLimit', () => ({ fetchSalesWithoutLimit: mocks.readAll }));
vi.mock('@/hooks/useSalesStaffOptions', () => ({ useSalesStaffOptions: () => [] }));
vi.mock('../SalesMap', () => ({
  default: ({ onPlotClick }: { onPlotClick?: (plotId: string) => void }) => (
    <button type="button" onClick={() => onPlotClick?.('ไอลิน6-4')}>
      เลือกแปลง 4
    </button>
  ),
}));
vi.mock('../SalesPricing', () => ({ default: () => null }));
vi.mock('../DailyVisitsScheduleView', () => ({ default: () => null }));
vi.mock('../DailyHouseInspectionModal', () => ({ default: () => null }));
vi.mock('../RentalContractModal', () => ({ default: () => null }));
vi.mock('../RentalActionModal', () => ({ default: () => null }));
vi.mock('../RentalPaymentLedgerModal', () => ({ default: () => null }));
vi.mock('../CentralLeadBookingModal', () => ({ default: () => null }));
vi.mock('../SalesDealStatusModal', () => ({ default: () => null }));
vi.mock('../CancelRentalBookingModal', () => ({ default: () => null }));

import SalesKanban from '../SalesKanban';

function makeChain(result: unknown) {
  const promise = Promise.resolve(result);
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    neq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => promise,
    single: () => promise,
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  };
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readAll.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe('SalesKanban right sidebar defect tracker button & shared modal', () => {
  it('filters defects by handover_cycle and maps defect/task photos in fetchPlotDefectTrackerData', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'defects') {
        return makeChain({
          data: [
            { id: 'd1', plot_id: 'ไอลิน6-4', handover_cycle: 2, progress: 100, status: 'resolved', description: 'เก็บสีผนัง', task_id: 't1' },
            { id: 'd2', plot_id: 'ไอลิน6-4', handover_cycle: 1, progress: 0, status: 'open', description: 'รายการรอบเก่าไม่ควรแสดง' },
          ],
          error: null,
        });
      }
      if (table === 'defect_updates') {
        return makeChain({
          data: [{ defect_id: 'd1', image_urls: 'https://example.com/fix1.jpg' }],
          error: null,
        });
      }
      if (table === 'task_updates') {
        return makeChain({
          data: [{ plot_id: 'ไอลิน6-4', task_template_id: 't1', image_url: 'https://example.com/task1.jpg' }],
          error: null,
        });
      }
      return makeChain({ data: [], error: null });
    });

    const data = await fetchPlotDefectTrackerData({ id: 'ไอลิน6-4', handover_cycle: 2 });
    expect(data.defects).toHaveLength(1);
    expect(data.defects[0].id).toBe('d1');
    expect(data.defectUpdatesMap['d1']).toHaveLength(1);
    expect(data.taskUpdatesMap['ไอลิน6-4_t1']).toHaveLength(1);
  });

  it('renders the defect button below ก่อสร้างเสร็จสิ้น in SalesKanban sidebar and opens the shared modal', async () => {
    const plotRow = {
      id: 'ไอลิน6-4',
      plot_name: '4',
      project_name: 'ไอลิน6',
      is_completed: true,
      handover_cycle: 1,
      house_type_id: 'ht-1',
      selling_price: 3890000,
      area_sqw: 50,
      house_types: { type_name: 'มากบุญบันดาล Ex' },
    };

    mocks.from.mockImplementation((table: string) => {
      if (table === 'plots') return makeChain({ data: plotRow, error: null });
      if (table === 'vw_plot_progress') return makeChain({ data: { overall_progress: 100 }, error: null });
      if (table === 'defects') {
        return makeChain({
          data: [
            { id: 'd1', plot_id: 'ไอลิน6-4', handover_cycle: 1, progress: 100, status: 'resolved', description: 'เก็บสีขอบประตู' },
            { id: 'd2', plot_id: 'ไอลิน6-4', handover_cycle: 1, progress: 50, status: 'in_progress', description: 'ยาแนวห้องน้ำ' },
          ],
          error: null,
        });
      }
      if (table === 'defect_updates') return makeChain({ data: [], error: null });
      if (table === 'task_updates') return makeChain({ data: [], error: null });
      return makeChain({ data: [], error: null });
    });

    render(<SalesKanban project={{ name: 'ไอลิน6' }} initialTab="map" user={{ id: 'u1', username: 'FIELD', role: 'Sales' }} />);

    fireEvent.click(await screen.findByRole('button', { name: 'เลือกแปลง 4' }));

    await screen.findByText('ก่อสร้างเสร็จสิ้น');
    const defectBtn = await screen.findByRole('button', { name: /ดูแผนเก็บงาน & ติดตามงานซ่อม \(1\/2 งาน\)/ });
    expect(defectBtn).toBeInTheDocument();

    fireEvent.click(defectBtn);

    await screen.findByText(/แผนเก็บงาน & ติดตามการแก้ไข \(Defects Punchlist\) — แปลง 4 \(ไอลิน6\)/);
    expect(screen.getByText('เก็บสีขอบประตู')).toBeInTheDocument();
    expect(screen.getByText('ยาแนวห้องน้ำ')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'ปิดหน้าต่าง' })[0]);
    await waitFor(() => {
      expect(screen.queryByText(/แผนเก็บงาน & ติดตามการแก้ไข/)).not.toBeInTheDocument();
    });
  });

  it('renders empty state cleanly inside SalesDefectTrackerModal when plot has no defects', () => {
    const onClose = vi.fn();
    render(
      <SalesDefectTrackerModal
        plot={{ id: 'p-1', plot_name: '15', project_name: 'ไอลิน6' }}
        plotDefects={[]}
        defectUpdatesMap={{}}
        taskUpdatesMap={{}}
        onClose={onClose}
      />
    );
    expect(screen.getByText('ยังไม่มีรายการแจ้งซ่อมสำหรับแปลงนี้')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'ปิดหน้าต่าง' })[0]);
    expect(onClose).toHaveBeenCalledOnce();
  });
});

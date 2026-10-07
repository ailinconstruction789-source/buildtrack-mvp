import React from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import WaitingForTransferDetails from '../WaitingForTransferDetails';

// Mock Supabase
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        in: vi.fn(() => Promise.resolve({ data: [] })),
        eq: vi.fn(() => Promise.resolve({ data: [] })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null })),
      })),
    })),
  },
}));

afterEach(cleanup);

describe('WaitingForTransferDetails component', () => {
  const samplePlot = {
    id: 'plot-ailin4-26',
    plot_name: '26',
    project_name: 'ไอลิน 4',
    selling_price: 3290000,
    progress: 100,
    sale_status: 'Waiting',
    house_types: { type_name: 'บ้านเดี่ยวชั้นเดียว' },
    activeSale: {
      saleId: 'sale-26',
      customerName: 'คุณวิรัลพัชร',
      expectedTransferDate: null,
      stage: 'booked',
    },
  };

  const sampleCarriedOverPlot = {
    id: 'plot-ailin6-18',
    plot_name: '18',
    project_name: 'ไอลิน6',
    selling_price: 3590000,
    progress: 95,
    sale_status: 'Waiting',
    house_types: { type_name: 'บ้านเดี่ยวสองชั้น' },
    activeSale: {
      saleId: 'sale-18',
      customerName: 'คุณลักษมี',
      expectedTransferDate: '2026-09-24',
      stage: 'contracted',
    },
  };

  const sampleRecords = [
    {
      id: 'sale-26',
      plot_id: 'plot-ailin4-26',
      customer_name: 'คุณวิรัลพัชร',
      expectedTransfer: null,
      transferDate: null,
      status: 'Reserved',
      statusLabel: 'รอโอน',
      createdDate: '2026-07-01',
    },
    {
      id: 'sale-18',
      plot_id: 'plot-ailin6-18',
      customer_name: 'คุณลักษมี',
      expectedTransfer: '2026-09-24',
      transferDate: null,
      status: 'Reserved',
      statusLabel: 'รอโอน',
      createdDate: '2026-06-27',
    },
  ];

  it('renders waiting plots and customer names from CRM V2 without hiding', async () => {
    await act(async () => {
      render(
        <WaitingForTransferDetails
          plots={[samplePlot]}
          carriedOverPlots={[]}
          validRecords={sampleRecords}
        />
      );
    });

    expect(screen.getByText('รายละเอียดบ้านที่รอโอน (Waiting for Transfer)')).toBeInTheDocument();
    expect(screen.getByText('เป้าหมายทั้งหมด 1 แปลง')).toBeInTheDocument();
    expect(screen.getByText(/คาดโอนตามเป้าหมายเดือนนี้/)).toBeInTheDocument();
    expect(screen.getByText(/โครงการ ไอลิน 4 - แปลง 26/)).toBeInTheDocument();
    expect(screen.getByText(/คุณวิรัลพัชร/)).toBeInTheDocument();
  });

  it('renders carriedOverPlots section when overdue waiting plots are present', async () => {
    await act(async () => {
      render(
        <WaitingForTransferDetails
          plots={[samplePlot]}
          carriedOverPlots={[sampleCarriedOverPlot]}
          validRecords={sampleRecords}
        />
      );
    });

    expect(screen.getByText('เป้าหมายทั้งหมด 2 แปลง')).toBeInTheDocument();
    expect(screen.getByText(/คาดโอนตามเป้าหมายเดือนนี้ \(1 แปลง\)/)).toBeInTheDocument();
    expect(screen.getByText(/คาดโอนตกค้างจากเดือนก่อน \(1 แปลง\)/)).toBeInTheDocument();
    expect(screen.getByText(/โครงการ ไอลิน6 - แปลง 18/)).toBeInTheDocument();
    expect(screen.getByText(/คุณลักษมี/)).toBeInTheDocument();
  });

  it('does not return null if plots is empty but carriedOverPlots has plots', async () => {
    await act(async () => {
      render(
        <WaitingForTransferDetails
          plots={[]}
          carriedOverPlots={[sampleCarriedOverPlot]}
          validRecords={sampleRecords}
        />
      );
    });

    expect(screen.getByText('รายละเอียดบ้านที่รอโอน (Waiting for Transfer)')).toBeInTheDocument();
    expect(screen.getByText('เป้าหมายทั้งหมด 1 แปลง')).toBeInTheDocument();
    expect(screen.getByText(/คาดโอนตกค้างจากเดือนก่อน \(1 แปลง\)/)).toBeInTheDocument();
  });

  it('returns null when both plots and carriedOverPlots are empty', async () => {
    let container: any;
    await act(async () => {
      const res = render(
        <WaitingForTransferDetails
          plots={[]}
          carriedOverPlots={[]}
          validRecords={[]}
        />
      );
      container = res.container;
    });

    expect(container.firstChild).toBeNull();
  });

  it('renders foreman checklist and admin documents sections for each plot', async () => {
    await act(async () => {
      render(
        <WaitingForTransferDetails
          plots={[samplePlot]}
          carriedOverPlots={[]}
          validRecords={sampleRecords}
        />
      );
    });

    expect(screen.getByText('ตรวจสอบงานก่อสร้าง & นัดตรวจบ้าน')).toBeInTheDocument();
    expect(screen.getByText('งานติดตั้งสุขภัณฑ์')).toBeInTheDocument();
    expect(screen.getByText('งานติดตั้งถังเก็บน้ำ และ ปั้มน้ำ')).toBeInTheDocument();
    expect(screen.getByText('งานปูหญ้า')).toBeInTheDocument();
    expect(screen.getByText('งานทำทรายล้าง')).toBeInTheDocument();
    expect(screen.getByText('งานทาสีเก็บรายละเอียด')).toBeInTheDocument();

    expect(screen.getByText('สถานะเอกสาร & สาธารณูปโภค (ธุรการ)')).toBeInTheDocument();
    expect(screen.getByText('ใบอนุญาตก่อสร้าง')).toBeInTheDocument();
    expect(screen.getByText('ทะเบียนบ้าน')).toBeInTheDocument();
    expect(screen.getByText('มิเตอร์น้ำ')).toBeInTheDocument();
    expect(screen.getByText('มิเตอร์ไฟฟ้า')).toBeInTheDocument();
  });

  it('renders unscheduledPlots section and empty state in expectingThisMonthPlots when none scheduled', async () => {
    const sampleUnscheduledPlot = {
      id: 'plot-ailin4-30',
      plot_name: '30',
      project_name: 'ไอลิน 4',
      selling_price: 3100000,
      progress: 90,
      sale_status: 'Waiting',
      house_types: { type_name: 'บ้านเดี่ยวชั้นเดียว' },
      activeSale: {
        saleId: 'sale-30',
        customerName: 'คุณสมชาย',
        expectedTransferDate: null,
        stage: 'booked',
      },
    };

    await act(async () => {
      render(
        <WaitingForTransferDetails
          plots={[]}
          carriedOverPlots={[]}
          unscheduledPlots={[sampleUnscheduledPlot]}
          validRecords={sampleRecords}
        />
      );
    });

    expect(screen.getByText('เป้าหมายทั้งหมด 1 แปลง')).toBeInTheDocument();
    expect(screen.getByText(/ไม่มีบ้านที่กำหนดวันคาดว่าจะโอนในเดือนนี้/)).toBeInTheDocument();
    expect(screen.getByText(/รอโอน - ยังไม่ระบุวันโอน \/ นัดหมายเดือนอื่น \(1 แปลง\)/)).toBeInTheDocument();
    expect(screen.getByText(/คุณสมชาย/)).toBeInTheDocument();
  });

  it('formats expected transfer date in Thai format (e.g. 24 ก.ย. 2569)', async () => {
    await act(async () => {
      render(
        <WaitingForTransferDetails
          plots={[sampleCarriedOverPlot]}
          carriedOverPlots={[]}
          validRecords={sampleRecords}
        />
      );
    });

    // 2026-09-24 -> 24 ก.ย. 2569
    expect(screen.getByText(/คาดการณ์: 24 ก\.ย\. 2569/)).toBeInTheDocument();
  });
});

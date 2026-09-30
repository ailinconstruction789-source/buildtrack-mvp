import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildExcelReport, type ExcelSaleRow } from '@/lib/sales/excelReportMetrics';
import CentralLegacyWaitingDetails from '../CentralLegacyWaitingDetails';
import { projectSalesSnapshot } from './projectSalesFixtures';

function fixture() {
  const report = buildExcelReport({ projects: [], loadedAt: '2026-09-30T06:00:00Z' }, null, '2026-09-30', '2026');
  const sale = projectSalesSnapshot().rows[1];
  const row: ExcelSaleRow = { sale, bookedDate: '2026-09-23', cancelledDate: null, transferredDate: null,
    expectedTransferDate: '2026-09-29', leadDate: null };
  report.forecast = [row];
  return report;
}

afterEach(cleanup);
describe('original waiting-for-transfer layout with central read-only evidence', () => {
  it('restores the house, inspection, administration and promotion card sections', () => {
    render(<CentralLegacyWaitingDetails report={fixture()} />);
    expect(screen.getByRole('heading', { name: 'รายละเอียดบ้านที่รอโอน (Waiting for Transfer)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'คาดโอนตามเป้าหมายเดือนนี้ (1 แปลง)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ตรวจสอบงานก่อสร้าง & นัดตรวจบ้าน' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'สถานะเอกสาร & สาธารณูปโภค (ธุรการ)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'สถานะของแถมโครงการ (Promotions)' })).toBeInTheDocument();
    expect(screen.getByText('คาดการณ์: 2026-09-29')).toBeInTheDocument();
    expect(screen.getByText('ลูกค้าคนเดิม')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ ลงวันนัดตรวจ' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /ดูแผนเก็บงาน/ })).toBeDisabled();
    for (const text of ['0%', 'สร้างเสร็จ', 'ผ่านแล้ว', 'ยังไม่ได้ดำเนินการ', 'แปลงนี้ไม่ได้เลือกรายการของแถม']) {
      expect(screen.queryByText(text, { exact: false })).not.toBeInTheDocument();
    }
  });

  it('keeps actual transfer evidence on the correct booking and carries earlier forecasts separately', () => {
    const report = fixture(), original = report.forecast[0];
    report.monthly.transferred = [{ ...original, transferredDate: '2026-09-15', expectedTransferDate: null,
      sale: { ...original.sale, saleId: 'transfer-sale', plotId: 'A-3', plotName: '3', stage: 'transferred', customerName: 'ลูกค้าที่โอนแล้ว' } }];
    report.carriedOver = [{ ...original, expectedTransferDate: '2026-08-30',
      sale: { ...original.sale, saleId: 'earlier-sale', plotId: 'A-4', plotName: '4', customerName: 'ลูกค้ารอตกค้าง' } }];
    report.unknownForecast = 2;
    render(<CentralLegacyWaitingDetails report={report} />);
    expect(screen.getByText('เป้าหมายทั้งหมด 3 แปลง')).toBeInTheDocument();
    const transferred = within(screen.getByRole('article', { name: 'รายละเอียด โครงการ A แปลง 3' }));
    expect(transferred.getByText('โอนสำเร็จ')).toBeInTheDocument();
    expect(transferred.getByText('2026-09-15')).toBeInTheDocument();
    expect(transferred.getByText('คาดการณ์: ไม่ทราบ')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'คาดโอนตกค้างจากเดือนก่อน (1 แปลง)' })).toBeInTheDocument();
    expect(screen.getByText(/ยังไม่ทราบวันที่คาดโอน 2 รายการ/)).toBeInTheDocument();
  });

  it('shows carried-over entries even if the selected month has no known target', () => {
    const report = fixture(); report.carriedOver = report.forecast; report.forecast = [];
    render(<CentralLegacyWaitingDetails report={report} />);
    expect(screen.getByRole('heading', { name: 'คาดโอนตกค้างจากเดือนก่อน (1 แปลง)' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /คาดโอนตามเป้าหมายเดือนนี้/ })).not.toBeInTheDocument();
  });

  it('has no legacy data access, writer, or zero-default construction evidence', () => {
    const source = readFileSync('components/sales/CentralLegacyWaitingDetails.tsx', 'utf8');
    for (const unsafe of ['@/lib/supabase', '.from(', '.update(', '.insert(', 'fetch(', 'WaitingForTransferDetails', 'progress || 0', 'onClick=']) {
      expect(source).not.toContain(unsafe);
    }
  });
});

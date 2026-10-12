import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import CustomerHistoryTimeline from '../CustomerHistoryTimeline';
import { customerHistoryTimeline } from '@/lib/sales/customerHistory';
afterEach(cleanup);
describe('customer event dates', () => {
  it('shows partial real history and does not infer missing steps from a transferred status', () => {
    render(<CustomerHistoryTimeline history={customerHistoryTimeline({ created_at: '2026-10-09T10:00:00Z' }, undefined, { transferred: '2025-03-01' })} />);
    const history = screen.getByRole('region', { name: 'ประวัติวันที่ลูกค้า' });
    expect(within(history).getByText('01/03/2568')).toBeInTheDocument();
    expect(within(history).getAllByText('ไม่มีบันทึกเดิม')).toHaveLength(6);
    expect(history).toHaveTextContent('วันที่ที่ไม่มีบันทึกไม่ได้หมายความว่ายังไม่ได้ทำขั้นตอนนั้น');
    expect(history).not.toHaveTextContent('09/10/2569');
  });
  it('distinguishes recorded instants from date-only evidence', () => {
    render(<CustomerHistoryTimeline history={customerHistoryTimeline({ booked_at: '2026-03-01T18:00:00Z' }, undefined, { visited: '2026-03-03' })} />);
    expect(screen.getByText('02/03/2569')).toBeInTheDocument(); expect(screen.getByText('03/03/2569')).toBeInTheDocument();
    expect(screen.getAllByText('ไม่ทราบเวลา')).toHaveLength(1);
  });
});

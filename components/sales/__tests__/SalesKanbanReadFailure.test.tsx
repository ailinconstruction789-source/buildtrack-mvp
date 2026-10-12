import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SalesKanban from '../SalesKanban';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/lib/sales/fetchWithoutLimit', () => ({ fetchSalesWithoutLimit: mocks.read }));
vi.mock('../DailyVisitsScheduleView', () => ({ default: () => null }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: () => {
    const response = Promise.resolve({ data: [], error: null });
    const query = { select: () => query, eq: () => query, order: () => query,
      in: () => query, maybeSingle: () => Promise.resolve({ data: null, error: null }), then: response.then.bind(response) };
    return query;
  },
  rpc: () => Promise.resolve({ data: { rows: [] }, error: null }),
  auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
} }));
vi.mock('@/lib/sales/sampleHouseHelper', () => ({
  isSampleHouse: () => false, isPlotEligibleForSampleHouse: () => false, toggleSampleHouse: vi.fn(),
  fetchTodayInspectionStatus: () => Promise.resolve(null),
}));

beforeEach(() => { mocks.read.mockReset(); mocks.read.mockResolvedValue([]); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Sales Kanban failed reads', () => {
  it('shows an availability failure instead of silently presenting complete counts', async () => {
    mocks.read.mockRejectedValueOnce(new Error('plots page failed'));
    render(<SalesKanban projects={[{ name: 'A' }]} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('โหลดจำนวนบ้านว่างไม่สำเร็จ');
  });

  it('shows a failed project read and lets the user retry', async () => {
    mocks.read.mockRejectedValueOnce(new Error('leads page failed'));
    render(<SalesKanban project={{ name: 'A' }} projects={[{ name: 'A' }]} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('โหลดข้อมูลการขายไม่สำเร็จ');
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

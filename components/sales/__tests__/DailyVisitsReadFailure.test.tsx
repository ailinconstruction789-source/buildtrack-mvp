import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DailyVisitsScheduleView from '../DailyVisitsScheduleView';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/lib/sales/fetchWithoutLimit', () => ({ fetchSalesWithoutLimit: mocks.read }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) } }));
vi.mock('@/lib/sales/sampleHouseHelper', () => ({
  isSampleHouse: () => false,
  fetchTodayInspectionMap: () => Promise.resolve({}),
  fetchTodayInspectionStatus: () => Promise.resolve({ isSampleHouse: true, status: 'pending', badgeLabel: 'Pending', badgeColor: '', badgeBg: '', icon: 'alert' }),
}));
vi.mock('../HouseVisitChecklistModal', () => ({ default: () => null }));
vi.mock('../CustomerVoicesModal', () => ({ default: () => null }));
vi.mock('../DailyHouseInspectionModal', () => ({ default: () => null }));

beforeEach(() => { mocks.read.mockReset(); mocks.read.mockResolvedValue([]); });
afterEach(cleanup);

describe('daily visits failed complete read', () => {
  it('reports rejected pagination and recovers after retry without an unhandled rejection', async () => {
    mocks.read.mockRejectedValueOnce(new Error('page failed'));
    render(<DailyVisitsScheduleView projects={[{ name: 'A' }]} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('โหลดรายการนัดหมายไม่สำเร็จ');
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it('ignores a late rejected read after unmount', async () => {
    let reject!: (error: Error) => void;
    mocks.read.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
    const { unmount } = render(<DailyVisitsScheduleView projects={[{ name: 'A' }]} />);
    unmount();
    await act(async () => { reject(new Error('late failure')); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

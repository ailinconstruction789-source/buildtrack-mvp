import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SalesKanban, { STATUS_CONFIG, stageToKanbanStatus, kanbanStatusToStage } from '../SalesKanban';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  onPlotClickCallback: vi.fn()
}));

vi.mock('@/lib/sales/fetchWithoutLimit', () => ({ fetchSalesWithoutLimit: mocks.read }));
vi.mock('../DailyVisitsScheduleView', () => ({ default: () => null }));
vi.mock('../SalesMap', () => ({
  default: ({ onPlotClick }: { onPlotClick: (plotId: string, status: string, lead?: any) => void }) => (
    <div data-testid="mock-sales-map">
      <button
        data-testid="click-plot-81-unknown-status"
        onClick={() => onPlotClick('ไอลิน 4-81', 'Follow Up', {
          name: 'คุณสมชาย',
          phone: '0812345678',
          status: 'Follow Up',
          plot: 'ไอลิน 4-81',
          salePrice: 3500000
        })}
      >
        Plot 81 Follow Up
      </button>
      <button
        data-testid="click-plot-81-undefined-status"
        onClick={() => onPlotClick('ไอลิน 4-81', 'CustomStatus', {
          name: 'คุณวิภา',
          phone: '0899999999',
          status: undefined,
          plot: 'ไอลิน 4-81'
        })}
      >
        Plot 81 Undefined Status
      </button>
    </div>
  )
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => {
      const response = Promise.resolve({ data: [], error: null });
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        in: () => query,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: response.then.bind(response)
      };
      return query;
    },
    rpc: () => Promise.resolve({ data: { rows: [] }, error: null }),
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) }
  }
}));

vi.mock('@/lib/sales/sampleHouseHelper', () => ({
  isSampleHouse: () => false,
  isPlotEligibleForSampleHouse: () => false,
  toggleSampleHouse: vi.fn(),
  fetchTodayInspectionStatus: () => Promise.resolve(null),
}));

beforeEach(() => {
  mocks.read.mockReset();
  mocks.read.mockResolvedValue([]);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SalesKanban Plot Click Safety', () => {
  it('converts unknown and extended stages safely', () => {
    expect(stageToKanbanStatus('visit')).toBe('Visit');
    expect(stageToKanbanStatus('negotiation')).toBe('Negotiation');
    expect(stageToKanbanStatus('booked')).toBe('Reserved');
    expect(stageToKanbanStatus('lost')).toBe('Lost');
    expect(kanbanStatusToStage('Visit')).toBe('visit');
    expect(kanbanStatusToStage('Lost')).toBe('lost');
  });

  it('STATUS_CONFIG contains aliases for common lead stages', () => {
    expect(STATUS_CONFIG['Booked']).toBeDefined();
    expect(STATUS_CONFIG['Follow Up']).toBeDefined();
    expect(STATUS_CONFIG['Active']).toBeDefined();
    expect(STATUS_CONFIG['legacy_unclassified']).toBeDefined();
  });

  it('renders customer panel without throwing when clicking plot with unknown lead status', async () => {
    render(
      <SalesKanban
        initialTab="map"
        project={{ name: 'ไอลิน 4' }}
        projects={[{ name: 'ไอลิน 4' }]}
      />
    );

    const button = screen.getByTestId('click-plot-81-unknown-status');
    // Clicking should not throw "Cannot read properties of undefined (reading 'icon')"
    expect(() => fireEvent.click(button)).not.toThrow();

    // Verify Customer Panel rendered
    expect(await screen.findByText('ข้อมูลลูกค้า')).toBeInTheDocument();
    expect(screen.getByDisplayValue('คุณสมชาย')).toBeInTheDocument();
    expect(screen.getByText('อัปเดตสถานะการขาย (Guided Workflow)')).toBeInTheDocument();
  });

  it('renders customer panel without throwing when clicking plot with undefined status', async () => {
    render(
      <SalesKanban
        initialTab="map"
        project={{ name: 'ไอลิน 4' }}
        projects={[{ name: 'ไอลิน 4' }]}
      />
    );

    const button = screen.getByTestId('click-plot-81-undefined-status');
    expect(() => fireEvent.click(button)).not.toThrow();

    expect(await screen.findByText('ข้อมูลลูกค้า')).toBeInTheDocument();
    expect(screen.getByDisplayValue('คุณวิภา')).toBeInTheDocument();
  });
});

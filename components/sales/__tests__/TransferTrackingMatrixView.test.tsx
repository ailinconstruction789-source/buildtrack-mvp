import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import TransferTrackingMatrixView from '../TransferTrackingMatrixView';

// Mock Supabase
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        order: vi.fn().mockResolvedValue({ data: [{ id: '1', name: 'ไอลิน สันทราย' }] }),
        eq: vi.fn().mockResolvedValue({ data: [] }),
        in: vi.fn().mockResolvedValue({ data: [] }),
      }))
    }))
  }
}));

describe('TransferTrackingMatrixView Component', () => {
  it('renders the header and month selectors correctly', () => {
    render(<TransferTrackingMatrixView />);
    
    expect(screen.getByText(/ตารางติดตามบ้านรอโอน/i)).toBeDefined();
    expect(screen.getByText(/^เดือน:$/)).toBeDefined();
    expect(screen.getByText(/^ถึงเดือน:$/)).toBeDefined();
    expect(screen.getByText(/Export Excel/i)).toBeDefined();
    expect(screen.getAllByText(/ดูทุกเดือน/i).length).toBeGreaterThanOrEqual(1);
  });
});

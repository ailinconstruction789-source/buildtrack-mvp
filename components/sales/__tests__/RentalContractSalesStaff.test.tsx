import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RentalContractModal from '../RentalContractModal';

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));
vi.mock('../LeadPicker', () => ({ default: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockImplementation((table: string) => ({
    select: vi.fn(() => table === 'users'
      ? Promise.resolve({ data: [
        { id: 1, username: 'Sales A', role: 'Sales' },
        { id: 2, username: 'Foreman A', role: 'Foreman' },
        { id: 3, username: 'Admin A', role: 'Admin' }
      ], error: null })
      : { eq: vi.fn().mockResolvedValue({ data: [], error: null }) })
  }));
});

describe('Rental contract sales staff', () => {
  it('loads eligible sales staff for legacy callers without an owner list', async () => {
    render(<RentalContractModal isOpen onClose={vi.fn()} user={{ username: 'Admin A', role: 'Admin' }} />);
    const option = await screen.findByRole('option', { name: 'Sales A' });
    const select = option.closest('select')!;
    expect(within(select).getAllByRole('option').map(item => item.textContent)).toEqual(['Sales A']);
    expect(select).toHaveValue('Sales A');
    expect(mocks.from).toHaveBeenCalledWith('users');
  });

  it('reuses eligible owners from Sales Hub without fetching users again', async () => {
    render(<RentalContractModal isOpen onClose={vi.fn()} user={{ username: 'Admin A', role: 'Admin' }}
      salesOwners={[{ userId: '1', displayName: 'Sales A' }]} />);
    const option = await screen.findByRole('option', { name: 'Sales A' });
    expect(within(option.closest('select')!).getAllByRole('option')).toHaveLength(1);
    expect(mocks.from).not.toHaveBeenCalledWith('users');
  });
});

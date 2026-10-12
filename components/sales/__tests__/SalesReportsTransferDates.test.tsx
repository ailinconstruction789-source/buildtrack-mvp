import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SalesReports from '../SalesReports';
vi.mock('../SalesKanban', () => ({ STATUS_CONFIG: {} }));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ComposedChart: () => null, Area: () => null, Line: () => null, XAxis: () => null, YAxis: () => null,
  CartesianGrid: () => null, Tooltip: () => null, Legend: () => null,
}));
afterEach(cleanup);
const row = { id: 'sale', name: 'Transferred Customer', status: 'Transferred', salePrice: 100,
  expectedTransferDate: '2026-10-30', history: [] };
describe('transfer report uses actual evidence', () => {
  it('groups a transferred customer with only a forecast under unknown month/year', () => {
    render(<SalesReports leads={[row]} projectName="Project" />);
    fireEvent.click(screen.getByRole('button', { name: 'สรุปยอดโอน' }));
    expect(screen.getByText('ยอดโอน ไม่ระบุเดือน/ปี')).toBeInTheDocument();
    expect(screen.getByText(row.name)).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('Unknown');
  });
  it('groups by the actual year even when the forecast belongs to a different year', () => {
    render(<SalesReports leads={[{ ...row, transferredDate: '2024-01-08' }]} projectName="Project" />);
    fireEvent.click(screen.getByRole('button', { name: 'สรุปยอดโอน' }));
    expect(screen.getByRole('combobox')).toHaveValue('2024');
    expect(screen.queryByRole('option', { name: '2569' })).not.toBeInTheDocument();
    expect(screen.getByText(row.name)).toBeInTheDocument();
  });
});

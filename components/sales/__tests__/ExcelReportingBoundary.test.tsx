import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ excel: vi.fn(), legacy: vi.fn() }));
vi.mock('next/dynamic', () => ({ default: () => mock.legacy }));
vi.mock('../CentralExcelReportWorkspace', () => ({ default: mock.excel }));
import SalesReportingEntry from '../SalesReportingEntry';
import SalesWorkspaceModeProvider from '../SalesWorkspaceModeProvider';
mock.excel.mockImplementation(() => <p>Excel central report</p>);
mock.legacy.mockImplementation(() => <p>legacy report</p>);
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('bounded Excel report release', () => {
  it('opens only the requested dashboard with project preserved', () => {
    render(<SalesWorkspaceModeProvider mode="central" reportsEnabled={false}><SalesReportingEntry surface="dashboard" active project={{ name: 'A' }}/></SalesWorkspaceModeProvider>);
    expect(mock.excel.mock.calls[0][0]).toEqual({ surface: 'dashboard', initialProjectName: 'A' }); expect(mock.legacy).not.toHaveBeenCalled();
  });
  it('opens summary but leaves owner reporting bounded', () => {
    const { rerender } = render(<SalesWorkspaceModeProvider mode="central" reportsEnabled={false}><SalesReportingEntry surface="summary"/></SalesWorkspaceModeProvider>);
    expect(mock.excel).toHaveBeenCalledOnce();
    rerender(<SalesWorkspaceModeProvider mode="central" reportsEnabled={false}><SalesReportingEntry surface="owner"/></SalesWorkspaceModeProvider>);
    expect(screen.queryByText('Excel central report')).not.toBeInTheDocument(); expect(mock.excel).toHaveBeenCalledOnce();
    expect(mock.legacy).not.toHaveBeenCalled();
  });
  it('does not load hidden dashboard or blocked workspace', () => {
    const { rerender } = render(<SalesWorkspaceModeProvider mode="central"><SalesReportingEntry surface="dashboard" active={false}/></SalesWorkspaceModeProvider>);
    expect(mock.excel).not.toHaveBeenCalled();
    rerender(<SalesWorkspaceModeProvider mode="blocked"><SalesReportingEntry surface="summary"/></SalesWorkspaceModeProvider>);
    expect(screen.getByRole('alert')).toBeInTheDocument(); expect(mock.excel).not.toHaveBeenCalled(); expect(mock.legacy).not.toHaveBeenCalled();
  });
});

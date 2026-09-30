import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExcelReportApi } from '@/lib/sales/excelReportClient';
import type { ExcelReportData } from '@/lib/sales/excelReportContracts';
vi.mock('@/lib/sales/excelReportClient', () => ({ excelReportApi: {} }));
vi.mock('../CentralExcelReportView', () => ({ default: ({ data, onRefresh }: { data: ExcelReportData; onRefresh: () => void }) => <div>report:{data.loadedAt}<button onClick={onRefresh}>refresh</button></div> }));
import CentralExcelReportWorkspace from '../CentralExcelReportWorkspace';
const deferred = () => { let resolve!: (data: ExcelReportData) => void; const promise = new Promise<ExcelReportData>(done => { resolve = done; }); return { promise, resolve }; };
const data = (label: string): ExcelReportData => ({ projects: [], loadedAt: label });
afterEach(cleanup);
describe('Excel workspace auth and complete-read boundary', () => {
  it('clears loaded customer data immediately when identity changes', async () => {
    let changed!: () => void;
    const pending = deferred(), stop = vi.fn();
    const api: ExcelReportApi = { read: vi.fn().mockResolvedValueOnce(data('first')).mockReturnValue(pending.promise), watchIdentity: callback => { changed = callback; return stop; } };
    const mounted = render(<CentralExcelReportWorkspace surface="summary" api={api}/>);
    await screen.findByText('report:first');
    act(() => changed()); expect(screen.queryByText('report:first')).not.toBeInTheDocument(); expect(screen.getByRole('status')).toBeInTheDocument();
    await act(async () => pending.resolve(data('second'))); expect(await screen.findByText('report:second')).toBeInTheDocument();
    mounted.unmount(); expect(stop).toHaveBeenCalledOnce();
  });
  it('does not show a delayed previous-account response', async () => {
    let changed!: () => void;
    const old = deferred(), fresh = deferred();
    const api: ExcelReportApi = { read: vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise), watchIdentity: callback => { changed = callback; return () => {}; } };
    render(<CentralExcelReportWorkspace surface="summary" api={api}/>);
    act(() => changed()); await act(async () => old.resolve(data('old')));
    expect(screen.queryByText('report:old')).not.toBeInTheDocument();
    await act(async () => fresh.resolve(data('new'))); expect(await screen.findByText('report:new')).toBeInTheDocument();
  });
  it('hides stale totals while refreshing and shows safe errors, never raw failure details', async () => {
    const api: ExcelReportApi = { read: vi.fn().mockResolvedValueOnce(data('first')).mockRejectedValueOnce(new Error('private customer details')), watchIdentity: () => () => {} };
    render(<CentralExcelReportWorkspace surface="summary" api={api}/>);
    await screen.findByText('report:first'); fireEvent.click(screen.getByRole('button', { name: 'refresh' }));
    expect(screen.queryByText('report:first')).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).not.toHaveTextContent('private');
  });
});

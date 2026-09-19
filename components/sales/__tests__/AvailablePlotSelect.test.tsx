import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/sales/plotAvailabilityClient', () => ({ loadAvailablePlots: vi.fn() }));
import AvailablePlotSelect from '../AvailablePlotSelect';
import type { InterestedPlot } from '@/lib/sales/plotAvailability';

const a: InterestedPlot = { id: 'โครงการ-A1', plot_name: 'A1', project_name: 'โครงการ A', has_customer: false, sale_status: 'active' };
const b: InterestedPlot = { ...a, id: 'โครงการ-A2', plot_name: 'A2' };
afterEach(cleanup);

function Form({ loadOptions }: { loadOptions: (project: string) => Promise<InterestedPlot[]> }) {
  const [value, setValue] = useState<InterestedPlot | null>(null);
  return <><AvailablePlotSelect projectName="โครงการ A" value={value} onChange={setValue} loadOptions={loadOptions} />
    <output data-testid="selected">{value?.id || ''}</output></>;
}

describe('AvailablePlotSelect', () => {
  it('requires a project and never loads every project as a fallback', () => {
    const loadOptions = vi.fn();
    render(<AvailablePlotSelect value={null} onChange={vi.fn()} loadOptions={loadOptions} />);
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(loadOptions).not.toHaveBeenCalled();
  });

  it('searches, selects by keyboard, and allows clearing optional interest', async () => {
    render(<Form loadOptions={vi.fn().mockResolvedValue([a, b])} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    await screen.findByRole('option', { name: /A1/ });
    fireEvent.change(input, { target: { value: 'A2' } });
    expect(screen.queryByRole('option', { name: /A1/ })).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('selected')).toHaveTextContent(b.id);
    expect(input).toHaveValue('A2');
    fireEvent.click(screen.getByRole('button', { name: /ล้าง/ }));
    expect(screen.getByTestId('selected')).toBeEmptyDOMElement();
  });

  it('does not save typed text or retain a different selected ID', async () => {
    render(<Form loadOptions={vi.fn().mockResolvedValue([a])} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.click(await screen.findByRole('option'));
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'unknown plot' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('selected')).toBeEmptyDOMElement();
  });

  it('ignores stale responses after changing project', async () => {
    let resolveOld!: (items: InterestedPlot[]) => void;
    const load = vi.fn((project: string) => project === 'โครงการ A'
      ? new Promise<InterestedPlot[]>(resolve => { resolveOld = resolve; })
      : Promise.resolve([{ ...b, project_name: 'โครงการ B' }]));
    const { rerender } = render(<AvailablePlotSelect projectName="โครงการ A" value={null} onChange={vi.fn()} loadOptions={load} />);
    rerender(<AvailablePlotSelect projectName="โครงการ B" value={null} onChange={vi.fn()} loadOptions={load} />);
    fireEvent.focus(screen.getByRole('combobox'));
    await screen.findByRole('option', { name: /A2/ });
    await act(async () => { resolveOld([a]); });
    expect(screen.queryByRole('option', { name: /A1/ })).not.toBeInTheDocument();
  });

  it('shows a recoverable error rather than presenting unknown stock as vacant', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([a]);
    render(<Form loadOptions={load} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('ตรวจสอบแปลงว่างไม่ได้');
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    fireEvent.focus(screen.getByRole('combobox'));
    expect(await screen.findByRole('option')).toHaveTextContent('A1');
  });
});

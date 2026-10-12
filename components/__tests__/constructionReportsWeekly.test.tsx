import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WeeklyProgressReportModal from '../WeeklyProgressReportModal';

const props = {
  isOpen: true, onClose: vi.fn(), selectedProject: { name: 'Project' },
  plots: [{ id: 12, project_name: 'Project', progress: 50, house_type_id: 1 }, { id: 'B', project_name: 'Elsewhere' }],
  houseTypes: [{ id: 1, name: 'House' }],
  getPlotOverallStatus: vi.fn(() => ({ actual: 50, planned: 60 })),
};
afterEach(() => vi.restoreAllMocks());

describe('weekly construction report (synthetic data)', () => {
  it('does no plot calculations while closed and calculates when opened', () => {
    props.getPlotOverallStatus.mockClear();
    const { container, rerender } = render(<WeeklyProgressReportModal {...props} isOpen={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(props.getPlotOverallStatus).not.toHaveBeenCalled();
    rerender(<WeeklyProgressReportModal {...props} />);
    expect(props.getPlotOverallStatus).toHaveBeenCalledTimes(1);
    expect(screen.getByText('12')).toBeInTheDocument();
    rerender(<WeeklyProgressReportModal {...props} isOpen={false} />);
    expect(props.getPlotOverallStatus).toHaveBeenCalledTimes(1);
  });
  it('supports numeric fallback plot names when sorting and searching', () => {
    render(<WeeklyProgressReportModal {...props} plots={[...props.plots, { id: 2, project_name: 'Project', progress: 50 }]} />);
    const input = screen.getByPlaceholderText('ค้นหาชื่อแปลง, แบบบ้าน หรือโฟร์แมน...');
    fireEvent.change(input, { target: { value: '12' } });
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(2);
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });
  it('releases every CSV Blob URL and removes the download anchor', () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:report'), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<WeeklyProgressReportModal {...props} />);
    const exportButton = screen.getByText('Export CSV').closest('button')!;
    fireEvent.click(exportButton); fireEvent.click(exportButton);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(click).toHaveBeenCalledTimes(2);
    expect(document.querySelector('a[download]')).toBeNull();
    vi.unstubAllGlobals();
  });
});

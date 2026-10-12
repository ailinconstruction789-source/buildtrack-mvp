import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MapVisualizer from '../MapVisualizer';

vi.mock('../WeeklyProgressReportModal', () => ({ default: () => null }));
vi.mock('../MeterStatusBadges', () => ({ default: () => null }));

const plot = { id: 'A', plot_name: 'A01', project_name: 'Project', house_type_id: 7 };
const props: React.ComponentProps<typeof MapVisualizer> = {
  view: 'project-detail', setView: vi.fn(), selectedProject: { name: 'Project' },
  isAdmin: false, currentUserRole: 'Foreman', isMobileLayout: false,
  isEditMapMode: false, setIsEditMapMode: vi.fn(), gridCols: 1, setGridCols: vi.fn(),
  gridRows: 1, setGridRows: vi.fn(), mapZoom: 1, handleZoomIn: vi.fn(),
  handleZoomOut: vi.fn(), handleZoomReset: vi.fn(), mapTool: 'plot', setMapTool: vi.fn(),
  mapSelectedPlot: '', setMapSelectedPlot: vi.fn(), plots: [plot], isSubmitting: false,
  handleSaveMap: vi.fn(), mapGrid: [{ x: 0, y: 0, type: 'plot', plotId: 'A' }],
  getAdjacency: vi.fn(() => ({})), handleMouseDown: vi.fn(), handleMouseEnter: vi.fn(),
  handleMouseUp: vi.fn(), setSelectedPlot: vi.fn(), setSelectedTask: vi.fn(),
  setTaskReturnView: vi.fn(), plotBounds: { A: { minX: 0, maxX: 0, minY: 0, maxY: 0 } },
  getPlotOverallStatus: vi.fn(() => ({ actual: 10, planned: 20, status: 'on-track', label: 'ปกติ' })),
  allUpdatesRecord: [], taskTemplates: [
    { id: 1, house_type_id: 7, task_name: 'Old foundation' },
    { id: 2, house_type_id: 7, task_name: 'New roofing' },
    { id: 3, house_type_id: 7, task_name: 'งานปูหญ้า' },
  ], assignments: [], searchTask: '', setSearchTask: vi.fn(),
  plotsActiveToday: new Set(), searchPlot: '', setSearchPlot: vi.fn(),
  filterForeman: '', setFilterForeman: vi.fn(), foremenList: [], displayPlots: [plot],
  handleDeletePlot: vi.fn(), handleEditPlot: vi.fn(), setIsPresentationOpen: vi.fn(),
  setCurrentSlideIndex: vi.fn(), loading: false, houseTypes: [{ id: 7, name: 'House' }],
};

describe('construction map', () => {
  it('shows newest work in both directory and tooltip after descending and appended history', () => {
    const newest = { id: 2, plot_id: 'A', task_template_id: 2, progress: 80, created_at: '2026-10-08T00:00:00Z' };
    const oldest = { id: 1, plot_id: 'A', task_template_id: 1, progress: 10, created_at: '2026-10-01T00:00:00Z' };
    const { rerender } = render(<MapVisualizer {...props} allUpdatesRecord={[newest, oldest]} />);
    expect(screen.getAllByText('New roofing (80%)')).toHaveLength(2);
    expect(screen.queryByText('Old foundation (10%)')).not.toBeInTheDocument();
    rerender(<MapVisualizer {...props} allUpdatesRecord={[oldest, newest]} />);
    expect(screen.getAllByText('New roofing (80%)')).toHaveLength(2);
  });

  it('keeps last matching assignment progress on radar and opens the matching task', () => {
    const setView = vi.fn();
    const setSelectedTask = vi.fn();
    render(<MapVisualizer {...props} searchTask="New roofing" setView={setView} setSelectedTask={setSelectedTask}
      assignments={[
        { plot_id: 'A', task_template_id: 2, current_progress: 20 },
        { plot_id: 'A', task_template_id: 2, current_progress: 75 },
        { plot_id: 'A', task_template_id: '2', current_progress: 100 },
      ]} />);
    expect(screen.getByText('75%')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('คลิกเพื่อเข้าห้องแชทของงานนี้'));
    expect(setSelectedTask).toHaveBeenCalledWith(props.taskTemplates[1]);
    expect(setView).toHaveBeenCalledWith('task-progress');
  });

  it('retains grass fallback but lets newer incomplete history remove the hatch', () => {
    const assignments = [{ plot_id: 'A', task_template_id: '3', current_progress: 100 }];
    const { container, rerender } = render(<MapVisualizer {...props} assignments={assignments} />);
    const hatch = () => Array.from(container.querySelectorAll<HTMLElement>('[style]'))
      .filter(element => element.style.backgroundSize === '30px 30px');
    expect(hatch()).toHaveLength(1);
    rerender(<MapVisualizer {...props} assignments={assignments} allUpdatesRecord={[
      { id: 2, plot_id: 'A', task_template_id: 3, progress: 25, created_at: '2026-10-08T00:00:00Z' },
      { id: 1, plot_id: 'A', task_template_id: 3, progress: 100, created_at: '2026-10-01T00:00:00Z' },
    ]} />);
    expect(hatch()).toHaveLength(0);
  });
});

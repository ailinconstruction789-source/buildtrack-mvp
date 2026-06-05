import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { useBuildTrackData } from '../useBuildTrackData';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

describe('useBuildTrackData Hook', () => {
  const mockUser = { username: 'testuser', role: 'Admin' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initially sets loading to true and does not fetch if user is null', () => {
    const { result } = renderHook(() => useBuildTrackData(null));
    expect(result.current.loading).toBe(true);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('fetches all data when loggedInUser is provided', async () => {
    const mockSelect = vi.fn().mockReturnThis();
    const mockOrder = vi.fn().mockReturnThis();
    const mockOr = vi.fn().mockReturnThis();
    const mockLimit = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockReturnThis();

    // Mock the chain methods and their final resolutions
    const createMockChain = (data: any) => ({
      select: mockSelect,
      order: mockOrder,
      or: mockOr,
      limit: mockLimit,
      eq: mockEq,
      then: (resolve: any) => resolve({ data, error: null })
    });

    (supabase.from as Mock).mockImplementation((table: string) => {
      if (table === 'projects') return createMockChain([{ name: 'Proj1', layout_data: [] }]);
      if (table === 'house_types') return createMockChain([{ id: 1, type_name: 'Type A' }]);
      if (table === 'task_templates') return createMockChain([{ id: 1, task_name: 'Task 1' }]);
      if (table === 'plots') return createMockChain([{ id: 'p1', house_types: { type_name: 'Type A' } }]);
      if (table === 'contractors') return createMockChain([{ id: 1, name: 'Cont 1' }]);
      if (table === 'notifications') return createMockChain([{ id: 1, message: 'Note 1' }]);
      if (table === 'vw_plot_progress') return createMockChain([{ plot_id: 'p1', overall_progress: 50 }]);
      if (table === 'vw_project_progress') return createMockChain([{ project_name: 'Proj1', plot_count: 1, project_progress: 50 }]);
      if (table === 'plot_task_assignments') return createMockChain([
        { plot_id: 'p1', task_template_id: 1, current_progress: 25, actual_start_date: '2023-01-01', actual_end_date: null }
      ]);
      if (table === 'task_updates') return createMockChain([{ id: 1, note: 'Update' }]);
      return createMockChain([]);
    });

    const { result } = renderHook(() => useBuildTrackData(mockUser));

    // Wait for the hook to finish loading
    await act(async () => {
      // Small delay to allow Promises to resolve
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.projects).toHaveLength(1);
    expect(result.current.projects[0].progress).toBe(50);
    
    expect(result.current.plots).toHaveLength(1);
    expect(result.current.plots[0].progress).toBe(50);
    expect(result.current.plots[0].type).toBe('Type A');

    expect(result.current.latestUpdatesMap['p1-1']).toEqual({
      plot_id: 'p1', task_template_id: 1, progress: 25
    });

    expect(result.current.taskDates['p1-1']).toEqual({
      start: '2023-01-01', end: null
    });
  });

  it('fetchPlotDetails lazily loads specific plot data and updates state atomically', async () => {
    const mockSelect = vi.fn().mockReturnThis();
    const mockOrder = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockReturnThis();

    const createMockChain = (data: any) => ({
      select: mockSelect,
      order: mockOrder,
      eq: mockEq,
      then: (resolve: any) => resolve({ data, error: null })
    });

    (supabase.from as Mock).mockImplementation((table: string) => {
      if (table === 'plot_task_schedules') return createMockChain([{ plot_id: 'p2', task_template_id: 2 }]);
      if (table === 'task_updates') return createMockChain([{ id: 2, plot_id: 'p2', task_template_id: 2 }]);
      if (table === 'defects') return createMockChain([{ id: 1, plot_id: 'p2', status: 'Open' }]);
      return createMockChain([]);
    });

    const { result } = renderHook(() => useBuildTrackData(null)); // Start with no user to avoid auto-fetch

    await act(async () => {
      await result.current.fetchPlotDetails('p2');
    });

    expect(result.current.schedules['p2-2']).toBeDefined();
    expect(result.current.schedules['p2-2'].plot_id).toBe('p2');
    
    expect(result.current.defects).toHaveLength(1);
    expect(result.current.defects[0].plot_id).toBe('p2');

    expect(result.current.latestUpdatesMap['p2-2']).toBeDefined();
    expect(result.current.latestUpdatesMap['p2-2'].id).toBe(2);

    expect(result.current.allUpdatesRecord).toHaveLength(1);
  });
});

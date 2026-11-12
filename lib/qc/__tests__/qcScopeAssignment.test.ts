import { describe, it, expect, vi, beforeEach } from 'vitest';
import { previewScopeAssignment, confirmScopeAssignment } from '../qcConfigService';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => {
  return {
    supabase: {
      from: vi.fn()
    }
  };
});

describe('Scope Assignment & Server Double-Verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('correctly partitions eligible vs started/locked tasks in preview', async () => {
    const mockPlots = [
      { id: 'PLOT-01', house_type_id: 'HT-01', project_name: 'PJ1', plot_name: 'P1' },
      { id: 'PLOT-02', house_type_id: 'HT-01', project_name: 'PJ1', plot_name: 'P2' }
    ];

    const createChain = () => {
      const chain: any = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        in: vi.fn(() => Promise.resolve({ data: mockPlots })),
        order: vi.fn(() => Promise.resolve({ data: [] })),
        maybeSingle: vi.fn(() => Promise.resolve({ data: null })),
        limit: vi.fn(() => Promise.resolve({ data: [] })),
        insert: vi.fn(() => Promise.resolve({ error: null })),
        upsert: vi.fn(() => Promise.resolve({ error: null }))
      };
      return chain;
    };

    const fromMock = vi.fn((table: string) => {
      const chain = createChain();
      if (table === 'plots') {
        chain.select = vi.fn(() => ({
          in: vi.fn(() => Promise.resolve({ data: mockPlots }))
        }));
      } else if (table === 'qc_inspections') {
        chain.select = vi.fn(() => ({
          eq: vi.fn((col, val) => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => Promise.resolve({
                data: val === 'PLOT-01' ? [{ id: 'insp-1', document_status: 'submitted' }] : []
              }))
            }))
          }))
        }));
      }
      return chain;
    });

    (supabase.from as any) = fromMock;

    const preview = await previewScopeAssignment({
      projectName: 'PJ1',
      selectedPlotIds: ['PLOT-01', 'PLOT-02'],
      taskTemplateId: 'TASK-101',
      taskName: 'งานโครงสร้างเสา',
      requirePlotDrawing: false
    });

    expect(preview.totalSelected).toBe(2);
    expect(preview.eligibleCount).toBe(1);
    expect(preview.skippedStartedCount).toBe(1);

    const startedItem = preview.items.find(i => i.plotId === 'PLOT-01');
    expect(startedItem?.status).toBe('already_started');

    const eligibleItem = preview.items.find(i => i.plotId === 'PLOT-02');
    expect(eligibleItem?.status).toBe('eligible');
  });

  it('detects missing plot-specific drawings when require_plot_drawing is true', async () => {
    const mockPlots = [
      { id: 'PLOT-01', house_type_id: 'HT-01', project_name: 'PJ1', plot_name: 'P1' }
    ];

    const createChain = () => {
      const chain: any = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        in: vi.fn(() => Promise.resolve({ data: mockPlots })),
        order: vi.fn(() => Promise.resolve({ data: [] })),
        maybeSingle: vi.fn(() => Promise.resolve({ data: null })),
        limit: vi.fn(() => Promise.resolve({ data: [] })),
        insert: vi.fn(() => Promise.resolve({ error: null })),
        upsert: vi.fn(() => Promise.resolve({ error: null }))
      };
      return chain;
    };

    const fromMock = vi.fn((table: string) => {
      const chain = createChain();
      if (table === 'plots') {
        chain.select = vi.fn(() => ({
          in: vi.fn(() => Promise.resolve({ data: mockPlots }))
        }));
      }
      return chain;
    });

    (supabase.from as any) = fromMock;

    const preview = await previewScopeAssignment({
      projectName: 'PJ1',
      selectedPlotIds: ['PLOT-01'],
      taskTemplateId: 'TASK-101',
      taskName: 'งานโครงสร้างเสา',
      requirePlotDrawing: true
    });

    expect(preview.incompleteCount).toBe(1);
    expect(preview.eligibleCount).toBe(0);
    expect(preview.items[0].status).toBe('missing_plot_drawing');
  });

  it('confirmScopeAssignment double-checks on server and refuses to overwrite started tasks', async () => {
    const createChain = () => {
      const chain: any = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        in: vi.fn(() => Promise.resolve({ data: [] })),
        order: vi.fn(() => Promise.resolve({ data: [] })),
        maybeSingle: vi.fn(() => Promise.resolve({ data: null })),
        limit: vi.fn(() => Promise.resolve({ data: [] })),
        insert: vi.fn(() => Promise.resolve({ error: null })),
        upsert: vi.fn(() => Promise.resolve({ error: null }))
      };
      return chain;
    };

    const fromMock = vi.fn((table: string) => {
      const chain = createChain();
      if (table === 'qc_inspections') {
        chain.select = vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => Promise.resolve({
                data: [{ id: 'race-insp', document_status: 'draft' }]
              }))
            }))
          }))
        }));
      }
      return chain;
    });

    (supabase.from as any) = fromMock;

    const result = await confirmScopeAssignment({
      projectName: 'PJ1',
      selectedPlotIds: ['PLOT-01'],
      taskTemplateId: 'TASK-101',
      taskName: 'งานโครงสร้างเสา',
      formTemplateId: 'FORM-01',
      formVersion: 1,
      requirePlotDrawing: false,
      actorUsername: 'Admin',
      actorRole: 'Admin'
    });

    expect(result.success).toBe(true);
    expect(result.assignedCount).toBe(0); // Protected!
    expect(result.skippedCount).toBe(1);
    expect(result.details[0].outcome).toBe('skipped_started');
  });
});

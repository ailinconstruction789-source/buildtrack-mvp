import React, { act } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import QCPlotTaskTab from '../QCPlotTaskTab';
import * as qcConfigService from '@/lib/qc/qcConfigService';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: [] }))
      })),
      upsert: vi.fn(() => Promise.resolve({ error: null }))
    }))
  }
}));

describe('QCPlotTaskTab Component', () => {
  const mockPlot = {
    id: 'PLOT-A01',
    project_name: 'The Grand Valley',
    house_type_id: 'HT-01',
    house_types: { type_name: 'Type Alpha' }
  };

  const mockTasks = [
    { id: 'TASK-1', task_name: 'งานเสาเข็ม', task_order: 1 },
    { id: 'TASK-2', task_name: 'งานโครงสร้างชั้น 1', task_order: 2 }
  ];

  it('renders task list and displays QC resolution information', async () => {
    vi.spyOn(qcConfigService, 'resolveTaskInspectionConfig').mockImplementation(async (params: any) => {
      if (params.taskTemplateId === 'TASK-1') {
        return {
          state: 'form_v2_ready',
          inspectionMethod: 'form_v2',
          isLocked: false,
          sourceLabel: 'มาตรฐานโครงการ',
          formTemplate: { id: 'f1', title: 'แบบฟอร์มตรวจเสาเข็ม', version: 1 } as any
        };
      }
      return {
        state: 'legacy',
        inspectionMethod: 'legacy',
        isLocked: false,
        sourceLabel: 'ระบบเดิม'
      };
    });

    await act(async () => {
      render(
        <QCPlotTaskTab
          plot={mockPlot}
          taskTemplates={mockTasks}
          currentUserRole="Admin"
          loggedInUsername="AdminUser"
        />
      );
    });

    // Header displays plot title
    expect(screen.getByText(/PLOT-A01/i)).toBeInTheDocument();

    // Tasks should be rendered in table
    await waitFor(() => {
      expect(screen.getByText('งานเสาเข็ม')).toBeInTheDocument();
      expect(screen.getByText('งานโครงสร้างชั้น 1')).toBeInTheDocument();
    });

    // Badges should be displayed
    await waitFor(() => {
      expect(screen.getByText(/แบบฟอร์มตรวจเสาเข็ม/i)).toBeInTheDocument();
      expect(screen.getByText(/ระบบตรวจเดิม/i)).toBeInTheDocument();
    });
  });
});

import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import QCMasterPlanViewportModal from '../QCMasterPlanViewportModal';
import { QCReferenceDrawing } from '@/types/qc.types';
import * as qcDrawingService from '@/lib/qc/qcDrawingService';

vi.mock('@/lib/qc/qcDrawingService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/qc/qcDrawingService')>();
  return {
    ...actual,
    getProjectPlotViewports: vi.fn(),
    savePlotDrawingViewport: vi.fn(),
    deletePlotDrawingViewport: vi.fn()
  };
});

describe('QCMasterPlanViewportModal', () => {
  const mockDrawing: QCReferenceDrawing = {
    id: 'dwg-master-1',
    drawing_number: 'AL6001',
    title: 'ผังท่อใยหินโครงการไอลิน 6',
    file_url: 'https://example.com/masterplan.png',
    file_name: 'masterplan.png',
    file_type: 'image',
    version: 1,
    status: 'active',
    total_pages: 1,
    project_name: 'ไอลิน6'
  };

  const mockPlots = [
    { id: 'plot-1', plot_name: '1', project_name: 'ไอลิน6', house_type_id: 'ht-1' },
    { id: 'plot-2', plot_name: '2', project_name: 'ไอลิน6', house_type_id: 'ht-1' }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(qcDrawingService.getProjectPlotViewports).mockResolvedValue([]);
    vi.mocked(qcDrawingService.savePlotDrawingViewport).mockResolvedValue({ data: null, error: null });
  });

  it('supports zooming past 5x up to 25x via presets, slider, and zoom-in button and saves high zoom level', async () => {
    await act(async () => {
      render(
        <QCMasterPlanViewportModal
          isOpen={true}
          onClose={vi.fn()}
          drawing={mockDrawing}
          projectName="ไอลิน6"
          plots={mockPlots}
        />
      );
    });

    const preset15 = screen.getByRole('button', { name: '15x' });
    fireEvent.click(preset15);
    expect(screen.getByText('15.00x')).toBeInTheDocument();

    const zoomInBtn = screen.getByTitle('ซูมเข้า');
    fireEvent.click(zoomInBtn);
    expect(screen.getByText('16.00x')).toBeInTheDocument();

    const slider = screen.getByLabelText('ระดับการซูม') as HTMLInputElement;
    expect(slider.max).toBe('25');
    fireEvent.change(slider, { target: { value: '25' } });
    expect(screen.getByText('25.00x')).toBeInTheDocument();
    expect(zoomInBtn).toBeDisabled();

    const previewImg = screen.getByAltText('Preview') as HTMLImageElement;
    expect(previewImg.style.width).toBe('2500%');
    expect(previewImg.style.left).toBe('50%');
    expect(previewImg.style.top).toBe('50%');
    expect(previewImg.style.transform).toBe('translate(-50%, -50%)');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /บันทึกมุมมอง/i }));
    });

    expect(qcDrawingService.savePlotDrawingViewport).toHaveBeenCalledWith({
      project_name: 'ไอลิน6',
      plot_id: 'plot-1',
      drawing_id: 'dwg-master-1',
      x_percent: 50,
      y_percent: 50,
      zoom_level: 25
    });
  });

  it('preserves selected zoom level when advancing to the next unmapped plot', async () => {
    await act(async () => {
      render(
        <QCMasterPlanViewportModal
          isOpen={true}
          onClose={vi.fn()}
          drawing={mockDrawing}
          projectName="ไอลิน6"
          plots={mockPlots}
        />
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '15x' }));
    expect(screen.getByText('15.00x')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /บันทึก & แปลงถัดไป/i }));
    });

    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select.value).toBe('plot-2');
    });
    expect(screen.getByText('15.00x')).toBeInTheDocument();
  });

  it('opens full interactive QC viewer preview with current zoom and coordinates', async () => {
    await act(async () => {
      render(
        <QCMasterPlanViewportModal
          isOpen={true}
          onClose={vi.fn()}
          drawing={mockDrawing}
          projectName="ไอลิน6"
          plots={mockPlots}
        />
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '15x' }));
    fireEvent.click(screen.getByRole('button', { name: /ทดลองดูหน้าตรวจ QC จริง/i }));

    expect(screen.getByText(/ตัวอย่างมุมมองจริงในหน้าตรวจ QC/i)).toBeInTheDocument();
    expect(screen.getByText('1500%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /ปิดตัวอย่าง/i }));
    expect(screen.queryByText(/ตัวอย่างมุมมองจริงในหน้าตรวจ QC/i)).not.toBeInTheDocument();
  });
});

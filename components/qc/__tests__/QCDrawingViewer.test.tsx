import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import QCDrawingViewer from '../QCDrawingViewer';
import { QCReferenceDrawing, QCDrawingAnnotation } from '@/types/qc.types';

describe('QCDrawingViewer Component', () => {
  const mockDrawing: QCReferenceDrawing = {
    id: 'draw-1',
    drawing_number: 'A-101',
    title: 'แบบแปลนชั้น 1',
    file_url: 'https://example.com/plan.pdf',
    file_name: 'plan.pdf',
    file_type: 'pdf',
    version: 1,
    status: 'active',
    total_pages: 2,
    pages: [
      {
        id: 'page-1',
        drawing_id: 'draw-1',
        page_number: 1,
        page_label: 'หน้า 1: แปลนพื้นชั้นล่าง',
        page_image_url: 'https://example.com/plan1.jpg',
        width: 1920,
        height: 1080
      },
      {
        id: 'page-2',
        drawing_id: 'draw-1',
        page_number: 2,
        page_label: 'หน้า 2: แปลนคานคอดิน',
        page_image_url: 'https://example.com/plan2.jpg',
        width: 1920,
        height: 1080
      }
    ]
  };

  const mockAnnotations: QCDrawingAnnotation[] = [
    {
      id: 'pin-1',
      inspection_id: 'insp-1',
      page_number: 1,
      x_ratio: 0.25,
      y_ratio: 0.5,
      pin_label: 'P01',
      remarks: 'รอยร้าวที่คาน',
      status: 'failed'
    }
  ];

  it('renders drawing pages switcher and displays initial page', () => {
    render(
      <QCDrawingViewer
        drawing={mockDrawing}
        annotations={mockAnnotations}
        initialPage={1}
      />
    );

    expect(screen.getByText(/แบบแปลนชั้น 1/i)).toBeInTheDocument();
    expect(screen.getByText(/A-101/i)).toBeInTheDocument();
    expect(screen.getByText(/หน้า 1 \/ 2/i)).toBeInTheDocument();
  });

  it('renders existing annotations with labels', () => {
    render(
      <QCDrawingViewer
        drawing={mockDrawing}
        annotations={mockAnnotations}
        initialPage={1}
      />
    );

    expect(screen.getByText('P01')).toBeInTheDocument();
  });

  it('toggles add pin mode button when onAddAnnotation is provided', () => {
    const onAddAnnotation = vi.fn();

    render(
      <QCDrawingViewer
        drawing={mockDrawing}
        annotations={mockAnnotations}
        initialPage={1}
        readOnly={false}
        onAddAnnotation={onAddAnnotation}
      />
    );

    const addPinBtn = screen.getByRole('button', { name: /ปักหมุดจุดวัด/i });
    expect(addPinBtn).toBeInTheDocument();

    fireEvent.click(addPinBtn);
    expect(screen.getByText(/แตะบนแบบเพื่อปักหมุด/i)).toBeInTheDocument();
  });

  it('switches pages when next page button is clicked', () => {
    render(
      <QCDrawingViewer
        drawing={mockDrawing}
        annotations={mockAnnotations}
        initialPage={1}
      />
    );

    const buttons = screen.getAllByRole('button');
    const nextBtn = buttons.find(b => b.querySelector('.lucide-chevron-right'));
    expect(nextBtn).toBeDefined();

    if (nextBtn) {
      fireEvent.click(nextBtn);
      expect(screen.getByText(/หน้า 2 \/ 2/i)).toBeInTheDocument();
    }
  });

  it('supports zooming above 3.5x up to 25x and preserves high viewport zoom when zooming in', () => {
    render(
      <QCDrawingViewer
        drawing={mockDrawing}
        annotations={mockAnnotations}
        initialPage={1}
        viewport={{
          project_name: 'ไอลิน6',
          plot_id: 'plot-1',
          drawing_id: 'draw-1',
          x_percent: 25,
          y_percent: 25,
          zoom_level: 12
        }}
      />
    );

    expect(screen.getByText('1200%')).toBeInTheDocument();

    const zoomInBtn = screen.getByTitle('ขยาย');
    fireEvent.click(zoomInBtn);
    expect(screen.getByText('1300%')).toBeInTheDocument();

    for (let i = 0; i < 15; i++) {
      fireEvent.click(zoomInBtn);
    }
    expect(screen.getByText('2500%')).toBeInTheDocument();
  });

  it('renders image at native zoomed layout dimensions after image load to preserve sharpness', () => {
    render(
      <QCDrawingViewer
        drawing={mockDrawing}
        annotations={mockAnnotations}
        initialPage={1}
        viewport={{
          project_name: 'ไอลิน6',
          plot_id: 'plot-1',
          drawing_id: 'draw-1',
          x_percent: 50,
          y_percent: 50,
          zoom_level: 10
        }}
      />
    );

    const img = screen.getByAltText('แบบแปลนชั้น 1') as HTMLImageElement;
    Object.defineProperty(img, 'naturalWidth', { value: 2000, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 4000, configurable: true });
    fireEvent.load(img);

    const container = img.parentElement as HTMLDivElement;
    expect(container.style.width).toBe('2380px');
    expect(container.style.height).toBe('4760px');
    expect(container.style.transform).not.toContain('scale(');
  });
});

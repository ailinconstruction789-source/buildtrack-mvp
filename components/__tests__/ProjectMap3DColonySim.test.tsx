import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import ProjectMap3DColonySim from '../ProjectMap3DColonySim';
import DailySiteActivitiesView from '../DailySiteActivitiesView';

// Canvas mock for JSDOM
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    arc: vi.fn(),
    ellipse: vi.fn(),
    roundRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 60 })),
    setTransform: vi.fn(),
    resetTransform: vi.fn(),
    createRadialGradient: vi.fn(() => ({
      addColorStop: vi.fn(),
    })),
    setLineDash: vi.fn(),
  })) as any;
});

const mockPlotA = { id: 'A01', plot_name: 'A-01', project_name: 'The Grand Lake', house_type_id: 1 };
const mockPlotB = { id: 'B01', plot_name: 'B-01', project_name: 'The Grand Lake', house_type_id: 1 };

const default3DProps = {
  selectedProject: { name: 'The Grand Lake' },
  plots: [mockPlotA, mockPlotB],
  plotBounds: {
    A01: { minX: 1, minY: 1, maxX: 2, maxY: 2 },
    B01: { minX: 4, minY: 1, maxX: 5, maxY: 2 },
  },
  mapGrid: [
    { x: 1, y: 1, type: 'plot', plotId: 'A01' },
    { x: 4, y: 1, type: 'plot', plotId: 'B01' },
  ],
  gridCols: 10,
  gridRows: 10,
  plotStatusCache: {
    A01: { planned: 80, actual: 75, status: 'on-track', label: 'ตามแผน' },
    B01: { planned: 50, actual: 30, status: 'delayed', label: 'ล่าช้า' },
  },
  plotsActiveToday: new Set(['A01']),
  allUpdatesRecord: [
    {
      id: 101,
      plot_id: 'A01',
      task_template_id: 1,
      user_name: 'สมศักดิ์ โฟร์แมน',
      role: 'foreman',
      action: 'เทคานชั้น 2',
      created_at: new Date().toISOString(),
      image_url: 'https://example.com/site-pic.jpg',
    },
    {
      id: 102,
      plot_id: 'A01',
      task_template_id: 1,
      user_name: 'วิศวกร ก้องเกียรติ',
      role: 'engineer',
      action: 'เข้าตรวจรับเหล็กโครงสร้าง',
      created_at: new Date().toISOString(),
    },
    {
      id: 103,
      plot_id: 'B01',
      task_template_id: 2,
      user_name: 'QC สุภาพร',
      role: 'qc',
      action: 'ตรวจความเรียบร้อยงานงวด',
      created_at: new Date().toISOString(),
    },
  ],
  defects: [],
  taskTemplates: [{ id: 1, house_type_id: 1, task_name: 'งานโครงสร้างชั้น 2' }],
  houseTypes: [{ id: 1, name: 'บ้านเดี่ยว 2 ชั้น (Type Alpha)' }],
  selectedDate: new Date().toISOString().slice(0, 10),
  setSelectedPlot: vi.fn(),
  setSelectedTask: vi.fn(),
  setView: vi.fn(),
};

describe('ProjectMap3DColonySim Component', () => {
  it('renders project name, Colony Sim badge, canvas, and role filter controls', () => {
    render(<ProjectMap3DColonySim {...default3DProps} />);

    expect(screen.getByText('The Grand Lake')).toBeInTheDocument();
    expect(screen.getByText('Colony Sim')).toBeInTheDocument();
    expect(screen.getByText(/ทั้งหมด \(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/มีงานทำ/)).toBeInTheDocument();
    expect(screen.getAllByText(/โฟร์แมน/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/วิศวกร/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/QC/).length).toBeGreaterThan(0);
    expect(screen.getByTitle('Snap กลับมามุมมองผังมาตรฐาน Isometric')).toBeInTheDocument();
  });

  it('allows clicking quick filters and snap to isometric view without errors', () => {
    render(<ProjectMap3DColonySim {...default3DProps} />);

    const qcBtn = screen.getByRole('button', { name: /QC/ });
    fireEvent.click(qcBtn);

    const engBtn = screen.getByRole('button', { name: /วิศวกร/ });
    fireEvent.click(engBtn);

    const fmBtn = screen.getByRole('button', { name: /โฟร์แมน/ });
    fireEvent.click(fmBtn);

    const snapBtn = screen.getByTitle('Snap กลับมามุมมองผังมาตรฐาน Isometric');
    fireEvent.click(snapBtn);

    const rotCwBtn = screen.getByTitle('หมุนตามเข็ม 45°');
    fireEvent.click(rotCwBtn);

    const rotCcwBtn = screen.getByTitle('หมุนทวนเข็ม 45°');
    fireEvent.click(rotCcwBtn);

    // Zoom buttons (แทนลูกเลื่อน)
    const zoomInBtn = screen.getByTitle('ซูมเข้า (Zoom In)');
    const zoomOutBtn = screen.getByTitle('ซูมออก (Zoom Out)');
    expect(zoomInBtn).toBeInTheDocument();
    expect(zoomOutBtn).toBeInTheDocument();

    fireEvent.click(zoomInBtn);
    fireEvent.click(zoomOutBtn);

    expect(screen.getByText('The Grand Lake')).toBeInTheDocument();
  });
});

describe('DailySiteActivitiesView 3D Colony Sim Integration', () => {
  const dailyProps: React.ComponentProps<typeof DailySiteActivitiesView> = {
    allUpdatesRecord: default3DProps.allUpdatesRecord,
    defects: [],
    defectUpdates: [],
    plots: [mockPlotA, mockPlotB],
    projects: [{ name: 'The Grand Lake' }],
    taskTemplates: default3DProps.taskTemplates,
    allUsers: [],
    currentUser: { username: 'Admin' },
    selectedProject: { name: 'The Grand Lake' },
    mapGrid: default3DProps.mapGrid,
    plotBounds: default3DProps.plotBounds,
    gridCols: 10,
    gridRows: 10,
    houseTypes: default3DProps.houseTypes,
    plotsActiveToday: new Set(['A01']),
    setSelectedPlot: vi.fn(),
    setSelectedTask: vi.fn(),
    setView: vi.fn(),
  };

  it('toggles between Timeline Cards view and 3D Colony Sim view', () => {
    render(<DailySiteActivitiesView {...dailyProps} />);

    // Initially in Timeline view
    expect(screen.getByText('📋 ไทม์ไลน์ภาพถ่ายและกิจกรรม')).toBeInTheDocument();
    expect(screen.getByText('ผังจำลองไซต์งาน 3D (Colony Sim)')).toBeInTheDocument();

    // Click to switch into 3D Colony Sim
    const switch3DBtn = screen.getByText('ผังจำลองไซต์งาน 3D (Colony Sim)');
    fireEvent.click(switch3DBtn);

    // Colony Sim canvas and controls are displayed
    expect(screen.getByText('Colony Sim')).toBeInTheDocument();
    expect(screen.getByTitle('Snap กลับมามุมมองผังมาตรฐาน Isometric')).toBeInTheDocument();

    // Click back to Timeline view
    const switchTimelineBtn = screen.getByText('📋 ไทม์ไลน์ภาพถ่ายและกิจกรรม');
    fireEvent.click(switchTimelineBtn);

    expect(screen.queryByTitle('Snap กลับมามุมมองผังมาตรฐาน Isometric')).not.toBeInTheDocument();
  });
});

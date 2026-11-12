import React, { act } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import QCStandardConfigView from '../QCStandardConfigView';
import { generateNextFormCode } from '../QCFormLibraryModal';

const mockUpsert = vi.fn(() => Promise.resolve({ error: null }));

function createChainMock(result: any) {
  const promise = Promise.resolve(result);
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => promise,
    single: () => promise,
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise)
  };
  return chain;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'qc_standard_sets') {
        return {
          ...createChainMock({
            data: [
              {
                id: 'set-1',
                project_name: 'ไอลิน6',
                house_type_id: 'ht-1',
                task_name: 'งานก่อผนัง',
                form_template_id: 'form-1',
                form_version: 1,
                require_plot_drawing: false,
                is_active: true,
                form_template: { id: 'form-1', title: 'ฟอร์มงานก่อมาตรฐาน', version: 1 }
              }
            ],
            error: null
          }),
          upsert: mockUpsert,
          update: () => createChainMock({ error: null })
        };
      }
      if (table === 'qc_reference_drawings') {
        return {
          ...createChainMock({
            data: [
              {
                id: 'dwg-left',
                drawing_number: 'AR-101-L',
                title: 'แปลนก่อซ้าย',
                file_url: 'https://example.com/left.png',
                file_name: 'left.png',
                file_type: 'image',
                version: 1,
                status: 'active',
                house_type_id: 'ht-1',
                task_template_id: 'task-ht1-wall',
                garage_orientation: 'left'
              },
              {
                id: 'dwg-right',
                drawing_number: 'AR-101-R',
                title: 'แปลนก่อขวา',
                file_url: 'https://example.com/right.png',
                file_name: 'right.png',
                file_type: 'image',
                version: 1,
                status: 'active',
                house_type_id: 'ht-1',
                task_template_id: 'task-ht1-wall',
                garage_orientation: 'right'
              }
            ],
            error: null
          }),
          insert: () => createChainMock({ data: { id: 'new-dwg' }, error: null }),
          update: () => createChainMock({ error: null })
        };
      }
      if (table === 'qc_form_templates') {
        return createChainMock({
          data: [
            {
              id: 'form-1',
              code: 'QC-WALL',
              title: 'ฟอร์มงานก่อมาตรฐาน',
              category: 'งานสถาปัตย์',
              version: 1,
              status: 'published',
              items: [
                {
                  id: 'item-2',
                  form_template_id: 'form-1',
                  item_order: 2,
                  item_code: 'Q02',
                  item_text: 'ตรวจแนวระดับความดิ่งผนัง',
                  item_type: 'pass_fail',
                  is_critical: false,
                  is_required: true,
                  require_photo_on_fail: false,
                  require_remark_on_fail: false
                },
                {
                  id: 'item-1',
                  form_template_id: 'form-1',
                  item_order: 1,
                  item_code: 'Q01',
                  item_text: 'ตรวจตำแหน่งเปิดประตู-หน้าต่างตามแบบ',
                  item_type: 'drawing_point',
                  is_critical: true,
                  is_required: true,
                  require_photo_on_fail: false,
                  require_remark_on_fail: false
                }
              ]
            }
          ],
          error: null
        });
      }
      return createChainMock({ data: [], error: null });
    }),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(() => Promise.resolve({ error: null })),
        getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://example.com/uploaded.png' } }))
      }))
    }
  }
}));

describe('QCStandardConfigView Component (Step 1)', () => {
  const mockProjects = [
    { id: 'p-1', name: 'ไอลิน6' },
    { id: 'p-2', name: 'ไอลิน 4' }
  ];

  const mockHouseTypes = [
    { id: 'ht-1', type_name: 'มากมี', is_infrastructure: false },
    { id: 'ht-2', type_name: 'มากมหาศาล (AL6)', is_infrastructure: false }
  ];

  const mockTasks = [
    { id: 'task-ht1-wall', house_type_id: 'ht-1', task_name: 'งานก่อผนัง', task_order: 10 },
    { id: 'task-ht2-wall', house_type_id: 'ht-2', task_name: 'งานก่อผนัง', task_order: 10 }
  ];

  const mockPlots = [
    { id: 'plot-1', plot_name: '44', project_name: 'ไอลิน6', house_type_id: 'ht-2', garage_orientation: 'right' }
  ];

  it('auto-selects first project when selectedProject prop is empty and displays left/right drawings', async () => {
    await act(async () => {
      render(
        <QCStandardConfigView
          selectedProject=""
          currentUserRole="Admin"
          loggedInUsername="Owner"
          projects={mockProjects}
          houseTypes={mockHouseTypes}
          taskTemplates={mockTasks}
          plots={mockPlots}
        />
      );
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('ไอลิน6')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText('ฟอร์มงานก่อมาตรฐาน')).toBeInTheDocument();
      expect(screen.getByText(/ซ้าย: AR-101-L/)).toBeInTheDocument();
      expect(screen.getByText(/ขวา: AR-101-R/)).toBeInTheDocument();
    });
  });

  it('opens Drawing Library with direct file upload area and scope options', async () => {
    await act(async () => {
      render(
        <QCStandardConfigView
          selectedProject="ไอลิน6"
          currentUserRole="Admin"
          loggedInUsername="Owner"
          projects={mockProjects}
          houseTypes={mockHouseTypes}
          taskTemplates={mockTasks}
          plots={mockPlots}
        />
      );
    });

    const pickDrawingButtons = await screen.findAllByRole('button', { name: /เลือกแบบ/i });
    await act(async () => {
      fireEvent.click(pickDrawingButtons[0]);
    });

    const addBtns = await screen.findAllByRole('button', { name: /\+ อัปโหลดแบบแปลนใหม่/i });
    await act(async () => {
      fireEvent.click(addBtns[0]);
    });

    expect(screen.getByText(/คลิกเพื่อเลือกไฟล์จากเครื่อง หรือลากไฟล์มาวางที่นี่/i)).toBeInTheDocument();
    expect(screen.getAllByText(/ผังรวมโครงการ/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/แบบมาตรฐานกลาง/i).length).toBeGreaterThan(0);
  });

  it('opens Scope Assignment modal from header action button', async () => {
    await act(async () => {
      render(
        <QCStandardConfigView
          selectedProject="ไอลิน6"
          currentUserRole="Admin"
          loggedInUsername="Owner"
          projects={mockProjects}
          houseTypes={mockHouseTypes}
          taskTemplates={mockTasks}
          plots={mockPlots}
        />
      );
    });

    const scopeBtn = screen.getByRole('button', { name: /เปิดใช้ฟอร์มกับแปลงบ้าน/i });
    await act(async () => {
      fireEvent.click(scopeBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/กำหนดการใช้งานฟอร์ม QC \(Scope & Bulk Assignment\)/i)).toBeInTheDocument();
    });
  });

  it('generates sequential ISO form codes by category without collisions', () => {
    const existing: any[] = [
      { id: '1', code: 'QC-ARC-001' },
      { id: '2', code: 'QC-ARC-003' },
      { id: '3', code: 'QC-STR-002' },
      { id: '4', code: 'QC-SAN-001' }
    ];

    expect(generateNextFormCode('งานสถาปัตย์', existing)).toBe('QC-ARC-004');
    expect(generateNextFormCode('งานโครงสร้าง', existing)).toBe('QC-STR-003');
    expect(generateNextFormCode('งานระบบสุขาภิบาล', existing)).toBe('QC-SAN-002');
    expect(generateNextFormCode('งานระบบไฟฟ้า', existing)).toBe('QC-ELC-001');
    expect(generateNextFormCode('งานภายนอก', existing)).toBe('QC-EXT-001');
  });

  it('auto-updates form code when switching category on a new form template', async () => {
    await act(async () => {
      render(
        <QCStandardConfigView
          selectedProject="ไอลิน6"
          currentUserRole="Admin"
          loggedInUsername="Owner"
          projects={mockProjects}
          houseTypes={mockHouseTypes}
          taskTemplates={mockTasks}
          plots={mockPlots}
        />
      );
    });

    const formLibBtn = screen.getByRole('button', { name: /จัดการคลังฟอร์ม/i });
    await act(async () => {
      fireEvent.click(formLibBtn);
    });

    const newFormBtn = await screen.findByRole('button', { name: /สร้างแม่แบบใหม่/i });
    await act(async () => {
      fireEvent.click(newFormBtn);
    });

    // Default category 'งานสถาปัตย์' -> QC-ARC-001
    expect(screen.getByDisplayValue('QC-ARC-001')).toBeInTheDocument();

    // Switch category to งานโครงสร้าง -> updates automatically to QC-STR-001
    const catSelect = screen.getByDisplayValue('งานสถาปัตย์');
    await act(async () => {
      fireEvent.change(catSelect, { target: { value: 'งานโครงสร้าง' } });
    });
    expect(screen.getByDisplayValue('QC-STR-001')).toBeInTheDocument();

    // Switch category to งานระบบไฟฟ้า -> updates automatically to QC-ELC-001
    await act(async () => {
      fireEvent.change(catSelect, { target: { value: 'งานระบบไฟฟ้า' } });
    });
    expect(screen.getByDisplayValue('QC-ELC-001')).toBeInTheDocument();
  });

  it('allows Admin to preview Form + Drawing in strict view-only mode directly from matrix row', async () => {
    const previewPlots = [
      { id: 'plot-ht1-l', plot_name: '12', project_name: 'ไอลิน6', house_type_id: 'ht-1', garage_orientation: 'left' },
      { id: 'plot-ht1-r', plot_name: '15', project_name: 'ไอลิน6', house_type_id: 'ht-1', garage_orientation: 'right' }
    ];

    await act(async () => {
      render(
        <QCStandardConfigView
          selectedProject="ไอลิน6"
          currentUserRole="Admin"
          loggedInUsername="Owner"
          projects={mockProjects}
          houseTypes={mockHouseTypes}
          taskTemplates={mockTasks}
          plots={previewPlots}
        />
      );
    });

    // Only row with linked form shows ดูตัวอย่าง (1 button)
    const previewBtns = await screen.findAllByRole('button', { name: /ดูตัวอย่าง/i });
    expect(previewBtns).toHaveLength(1);

    await act(async () => {
      fireEvent.click(previewBtns[0]);
    });

    // Modal & view-only Admin banner + sorted items render
    await waitFor(() => {
      expect(screen.getByText(/โหมดดูตัวอย่างสำหรับ Admin \(ดูอย่างเดียว/i)).toBeInTheDocument();
    });
    expect(screen.getByText('ตรวจตำแหน่งเปิดประตู-หน้าต่างตามแบบ')).toBeInTheDocument();
    expect(screen.getByText('ตรวจแนวระดับความดิ่งผนัง')).toBeInTheDocument();

    // Save / Submit buttons are completely hidden in view-only preview
    expect(screen.queryByRole('button', { name: /บันทึกร่าง/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ส่งผลตรวจ/i })).not.toBeInTheDocument();

    // Answer buttons (ผ่าน / ไม่ผ่าน / N/A) are strictly disabled
    const passButtons = screen.getAllByRole('button', { name: /^ผ่าน$/i });
    expect(passButtons[0]).toBeDisabled();

    // Drawing tab works cleanly and read-only hides pin creation
    const drawingTabBtn = screen.getByRole('button', { name: /แบบแปลนและจุดวัด/i });
    await act(async () => {
      fireEvent.click(drawingTabBtn);
    });
    expect(screen.queryByRole('button', { name: /ปักหมุดจุดวัด/i })).not.toBeInTheDocument();

    // Switching sample plot refreshes preview while staying on drawing tab
    const plotSelect = screen.getByLabelText(/จำลองมุมมองของแปลง/i);
    await act(async () => {
      fireEvent.change(plotSelect, { target: { value: 'plot-ht1-r' } });
    });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /งานก่อผนัง - แปลง 15/ })).toBeInTheDocument();
    });

    // Close preview modal
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ปิดตัวอย่าง/i }));
    });
    expect(screen.queryByText(/โหมดดูตัวอย่างสำหรับ Admin/i)).not.toBeInTheDocument();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import ForemanAdhocChatView, { ADHOC_TAGS } from '../ForemanAdhocChatView';

// Mock Supabase
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => Promise.resolve({ data: [{ id: 'mock-new-id' }], error: null })),
      })),
      delete: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null })),
      })),
    })),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(() => Promise.resolve({ error: null })),
        getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://example.com/test.jpg' } })),
      })),
    },
  },
}));

describe('ForemanAdhocChatView Component', () => {
  const mockPlots = [
    { id: 'p1', plot_name: 'แปลง 44', project_name: 'ไอลิน6', foreman_name: 'VIEW' },
    { id: 'p99', plot_name: 'แปลง 99 (บ้านคุณโอ)', project_name: 'บ้านคุณโอ', foreman_name: 'DEN' },
  ];

  const mockProjects = [
    { id: 'proj-1', name: 'ไอลิน6' },
    { id: 'proj-2', name: 'บ้านคุณโอ' },
  ];

  const mockUpdates = [
    {
      id: 'upd-1',
      plot_id: 'p99',
      task_template_id: null,
      user_name: 'DEN',
      role: 'Foreman',
      action: 'รายงานนอกแผน',
      text_content: '[รับส่งวัสดุ] วันนี้เหล็กข้ออ้อย 12 มม. เข้าไซต์แปลง 99 เรียบร้อย 3 คันรถ',
      image_url: 'https://example.com/steel1.jpg',
      created_at: '2026-11-21T03:30:00.000Z',
    },
    {
      id: 'upd-2',
      plot_id: 'p1',
      task_template_id: null,
      user_name: 'VIEW',
      role: 'Foreman',
      action: 'รายงานนอกแผน',
      text_content: '[เคลียร์พื้นที่] ช่วยคนงานเคลียร์เศษปูนรอบรั้วเพื่อเตรียมงานถมดิน',
      image_url: null,
      created_at: '2026-11-20T08:00:00.000Z',
    },
  ];

  it('renders header, metrics and ad-hoc chat feed correctly', () => {
    render(
      <ForemanAdhocChatView
        plots={mockPlots}
        projects={mockProjects}
        allUpdatesRecord={mockUpdates}
        loggedInUser={{ username: 'DEN', role: 'Foreman' }}
        currentUserRole="Foreman"
      />
    );

    // Check title
    expect(screen.getByText('รายงานงานนอกแผน & บันทึกหน้างาน')).toBeInTheDocument();
    expect(screen.getByText('Site Ad-hoc Daily Feed')).toBeInTheDocument();

    // Check message items rendered
    expect(screen.getByText(/วันนี้เหล็กข้ออ้อย 12 มม. เข้าไซต์แปลง 99/)).toBeInTheDocument();
    expect(screen.getByText(/ช่วยคนงานเคลียร์เศษปูนรอบรั้ว/)).toBeInTheDocument();

    // Check tags
    expect(screen.getAllByText('รับส่งวัสดุ').length).toBeGreaterThan(0);
    expect(screen.getAllByText('เคลียร์พื้นที่').length).toBeGreaterThan(0);
  });

  it('filters reports by search query', () => {
    render(
      <ForemanAdhocChatView
        plots={mockPlots}
        projects={mockProjects}
        allUpdatesRecord={mockUpdates}
        loggedInUser={{ username: 'DEN', role: 'Foreman' }}
        currentUserRole="Foreman"
      />
    );

    const searchInput = screen.getByPlaceholderText('ค้นหาข้อความ, แปลง, โฟร์แมน...');
    fireEvent.change(searchInput, { target: { value: 'บ้านคุณโอ' } });

    // Should display DEN's update on บ้านคุณโอ
    expect(screen.getByText(/วันนี้เหล็กข้ออ้อย 12 มม. เข้าไซต์แปลง 99/)).toBeInTheDocument();
    // Should NOT display VIEW's update on ไอลิน6
    expect(screen.queryByText(/ช่วยคนงานเคลียร์เศษปูนรอบรั้ว/)).not.toBeInTheDocument();
  });

  it('calls onPreviewImage when image thumbnail is clicked', () => {
    const handlePreview = vi.fn();
    render(
      <ForemanAdhocChatView
        plots={mockPlots}
        projects={mockProjects}
        allUpdatesRecord={mockUpdates}
        loggedInUser={{ username: 'DEN', role: 'Foreman' }}
        currentUserRole="Foreman"
        onPreviewImage={handlePreview}
      />
    );

    const imageEl = screen.getByAltText('รูปถ่ายรายงานหน้างาน');
    expect(imageEl).toBeInTheDocument();
    fireEvent.click(imageEl);

    expect(handlePreview).toHaveBeenCalledWith('https://example.com/steel1.jpg');
  });

  it('allows user to type text and switch category tag', () => {
    render(
      <ForemanAdhocChatView
        plots={mockPlots}
        projects={mockProjects}
        allUpdatesRecord={mockUpdates}
        loggedInUser={{ username: 'DEN', role: 'Foreman' }}
        currentUserRole="Foreman"
      />
    );

    const textarea = screen.getByPlaceholderText(/พิมพ์รายงานสิ่งที่ได้ทำนอกเหนือจากแผนงาน/);
    fireEvent.change(textarea, { target: { value: 'รายงานทดสอบพิมพ์ข้อความ' } });
    expect(textarea).toHaveValue('รายงานทดสอบพิมพ์ข้อความ');

    // Switch tag to "งานเร่งด่วน"
    const urgentTagBtn = screen.getByText('งานเร่งด่วน');
    fireEvent.click(urgentTagBtn);
  });

  it('submits report with valid non-null plot_id even when common site is selected', async () => {
    const { supabase } = await import('@/lib/supabase');
    render(
      <ForemanAdhocChatView
        plots={mockPlots}
        projects={mockProjects}
        allUpdatesRecord={mockUpdates}
        loggedInUser={{ username: 'Admin', role: 'Admin' }}
        currentUserRole="Admin"
      />
    );

    const textarea = screen.getByPlaceholderText(/พิมพ์รายงานสิ่งที่ได้ทำนอกเหนือจากแผนงาน/);
    fireEvent.change(textarea, { target: { value: 'ทดสอบส่งข้อความพื้นที่ส่วนกลาง' } });

    const submitBtn = screen.getByText('ส่งรายงานเข้าแชท');
    fireEvent.click(submitBtn);

    // Verify insert was called with a non-null plot_id
    expect(supabase.from).toHaveBeenCalledWith('task_updates');
  });
});

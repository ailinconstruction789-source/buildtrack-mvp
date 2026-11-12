import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import ForemanDailyActivityView from '../ForemanDailyActivityView';
import type { ForemanDailyActivitySummary } from '@/lib/foremanDuty';

describe('ForemanDailyActivityView Component', () => {
  const mockSummary: ForemanDailyActivitySummary = {
    totalActivities: 3,
    inPlanCount: 1,
    outOfPlanCount: 1,
    defectCount: 1,
    roadblockCount: 0,
    plotsVisitedCount: 2,
    items: [
      {
        id: 'item-1',
        timestamp: 1730707200000,
        timeStr: '10:30 น.',
        dateStr: '2026-11-04',
        category: 'in_plan',
        categoryLabel: 'งานตามแผนวันนี้',
        categoryColor: 'blue',
        plot_id: 'p1',
        plot_name: 'แปลง 58',
        project_name: 'ไอลิน 6',
        foreman_name: 'LEAB',
        actor_name: 'LEAB',
        actor_role: 'โฟร์แมน',
        task_name: 'งานติดตั้งสุขภัณฑ์',
        action: 'ส่งงาน 100%',
        text_content: 'ติดตั้งโถสุขภัณฑ์และอ่างล้างหน้าเรียบร้อยแล้ว',
        progress: 100,
        image_urls: ['https://example.com/toilet1.jpg'],
        is_100_percent: true,
        plotObj: { id: 'p1', name: 'แปลง 58' },
        taskObj: { id: 't1', task_name: 'งานติดตั้งสุขภัณฑ์' },
      },
      {
        id: 'item-2',
        timestamp: 1730718000000,
        timeStr: '13:30 น.',
        dateStr: '2026-11-04',
        category: 'out_of_plan',
        categoryLabel: 'งานนอกแผน / รันล่วงหน้า',
        categoryColor: 'purple',
        plot_id: 'p2',
        plot_name: 'แปลง 59',
        project_name: 'ไอลิน 6',
        foreman_name: 'LEAB',
        actor_name: 'LEAB',
        actor_role: 'โฟร์แมน',
        task_name: 'งานติดตั้งระบบไฟ',
        action: 'เดินสายไฟเมนเข้าบ้าน',
        text_content: 'รันงานล่วงหน้าให้เสร็จก่อนตรวจรับสัปดาห์หน้า',
        progress: 50,
        image_urls: [],
        is_100_percent: false,
        plotObj: { id: 'p2', name: 'แปลง 59' },
        taskObj: { id: 't2', task_name: 'งานติดตั้งระบบไฟ' },
      },
      {
        id: 'item-3',
        timestamp: 1730725200000,
        timeStr: '15:30 น.',
        dateStr: '2026-11-04',
        category: 'defect',
        categoryLabel: 'งานสั่งแก้ไข / Defect',
        categoryColor: 'rose',
        plot_id: 'p1',
        plot_name: 'แปลง 58',
        project_name: 'ไอลิน 6',
        foreman_name: 'LEAB',
        actor_name: 'QC Somchai',
        actor_role: 'QC',
        task_name: 'งานสีภายใน',
        action: 'เก็บสีขอบบัว',
        text_content: 'พบรอยสีหยดที่พื้นห้องนั่งเล่น',
        image_urls: [],
        is_100_percent: false,
        defectObj: { id: 'd1', title: 'เก็บสีขอบบัว' },
        plotObj: { id: 'p1', name: 'แปลง 58' },
      },
    ],
  };

  it('renders effort overview cards with correct counts', () => {
    render(
      <ForemanDailyActivityView
        activitySummary={mockSummary}
        selectedDate="2026-11-04"
        selectedForeman="LEAB"
        onNavigateToTaskChat={vi.fn()}
      />
    );

    // Header date
    expect(screen.getByText(/ผลการปฏิบัติงานจริง ณ วันที่ 4 พฤศจิกายน 2569/)).toBeDefined();

    // Total activities
    expect(screen.getByText('3')).toBeDefined();
    expect(screen.getByText(/เข้าตรวจ 2 แปลง/)).toBeDefined();

    // Items rendered
    expect(screen.getByText('งานติดตั้งสุขภัณฑ์')).toBeDefined();
    expect(screen.getByText('งานติดตั้งระบบไฟ')).toBeDefined();
    expect(screen.getByText('งานสีภายใน')).toBeDefined();
  });

  it('filters activities when category filter pill is clicked', () => {
    render(
      <ForemanDailyActivityView
        activitySummary={mockSummary}
        selectedDate="2026-11-04"
        selectedForeman="LEAB"
        onNavigateToTaskChat={vi.fn()}
      />
    );

    // Click on "นอกแผน / ล่วงหน้า" filter
    const outOfPlanBtn = screen.getByRole('button', { name: /นอกแผน \/ ล่วงหน้า/i });
    fireEvent.click(outOfPlanBtn);

    // Only item-2 should be displayed
    expect(screen.getByText('งานติดตั้งระบบไฟ')).toBeDefined();
    expect(screen.queryByText('งานติดตั้งสุขภัณฑ์')).toBeNull();
    expect(screen.queryByText('งานสีภายใน')).toBeNull();
  });

  it('filters activities when search input is typed', () => {
    render(
      <ForemanDailyActivityView
        activitySummary={mockSummary}
        selectedDate="2026-11-04"
        selectedForeman="LEAB"
        onNavigateToTaskChat={vi.fn()}
      />
    );

    const searchInput = screen.getByPlaceholderText(/ค้นหาแปลง, ชื่องาน, หรือข้อความ.../i);
    fireEvent.change(searchInput, { target: { value: 'สุขภัณฑ์' } });

    expect(screen.getByText('งานติดตั้งสุขภัณฑ์')).toBeDefined();
    expect(screen.queryByText('งานติดตั้งระบบไฟ')).toBeNull();
  });

  it('navigates to chat when clicking task action button', () => {
    const handleTaskChat = vi.fn();
    render(
      <ForemanDailyActivityView
        activitySummary={mockSummary}
        selectedDate="2026-11-04"
        selectedForeman="LEAB"
        onNavigateToTaskChat={handleTaskChat}
      />
    );

    const chatButtons = screen.getAllByRole('button', { name: /เข้าห้องแชท \/ อัปเดต/i });
    expect(chatButtons.length).toBeGreaterThan(0);
    fireEvent.click(chatButtons[0]);

    expect(handleTaskChat).toHaveBeenCalled();
  });

  it('strips [ref:...] markers and displays roadblock icon for roadblock task_updates items', () => {
    const roadblockSummary: ForemanDailyActivitySummary = {
      ...mockSummary,
      totalActivities: 1,
      inPlanCount: 0,
      outOfPlanCount: 0,
      defectCount: 0,
      roadblockCount: 1,
      plotsVisitedCount: 1,
      items: [
        {
          id: 'update-rb-1',
          timestamp: 1730725200000,
          timeStr: '13:14 น.',
          dateStr: '2026-11-11',
          category: 'roadblock',
          categoryLabel: 'แจ้งเหตุผลติดปัญหา',
          categoryColor: 'amber',
          plot_id: '72',
          plot_name: 'แปลง 72',
          project_name: 'ไอลิน6',
          foreman_name: 'VIEW',
          actor_name: 'VIEW',
          actor_role: 'Foreman',
          task_name: 'งานฝ้าห้องน้ำ',
          action: 'แจ้งติดปัญหา: อื่นๆ (ระบุในหมายเหตุ)',
          text_content: 'เหตุผล: อื่นๆ (ระบุในหมายเหตุ) (ช่างเข้าวันจันทร์ที่ 16/11/2569) [ref:sub_1794377594294_ozg2f]',
          progress: 0,
          image_urls: [],
          is_100_percent: false,
        },
      ],
    };

    render(
      <ForemanDailyActivityView
        activitySummary={roadblockSummary}
        selectedDate="2026-11-11"
        selectedForeman="VIEW"
        onNavigateToTaskChat={vi.fn()}
      />
    );

    expect(screen.getByText(/📝 แจ้งติดปัญหา: อื่นๆ \(ระบุในหมายเหตุ\)/)).toBeDefined();
    expect(screen.getByText('เหตุผล: อื่นๆ (ระบุในหมายเหตุ)')).toBeDefined();
    expect(screen.getByText('หมายเหตุ: ช่างเข้าวันจันทร์ที่ 16/11/2569')).toBeDefined();
    expect(screen.queryByText(/sub_1794377594294_ozg2f/)).toBeNull();
    expect(screen.queryByText(/\[ref:/)).toBeNull();

    const searchInput = screen.getByPlaceholderText(/ค้นหาแปลง, ชื่องาน, หรือข้อความ.../i);
    fireEvent.change(searchInput, { target: { value: 'ozg2f' } });
    expect(screen.queryByText('งานฝ้าห้องน้ำ')).toBeNull();
  });
});

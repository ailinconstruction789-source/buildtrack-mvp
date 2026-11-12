import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import RoadblockReasonCallout from '../RoadblockReasonCallout';
import DailySiteActivitiesView from '../DailySiteActivitiesView';
import { parseRoadblockDisplay } from '@/lib/foremanDuty';

describe('RoadblockReasonCallout and Roadblock UI Formatting', () => {
  it('renders roadblock icon, reason, and note cleanly without [ref:...] marker', () => {
    const roadblock = parseRoadblockDisplay(
      'เหตุผล: อื่นๆ (ระบุในหมายเหตุ) (ช่างเข้าวันจันทร์ที่ 16/11/2569) [ref:sub_1794377594294_ozg2f]',
      'แจ้งติดปัญหา: อื่นๆ (ระบุในหมายเหตุ)'
    );
    expect(roadblock).not.toBeNull();

    render(<RoadblockReasonCallout roadblock={roadblock!} />);

    expect(screen.getByText('📝')).toBeDefined();
    expect(screen.getByText('เหตุผล: อื่นๆ (ระบุในหมายเหตุ)')).toBeDefined();
    expect(screen.getByText('หมายเหตุ: ช่างเข้าวันจันทร์ที่ 16/11/2569')).toBeDefined();
    expect(screen.queryByText(/\[ref:/)).toBeNull();
    expect(screen.queryByText(/sub_1794377594294_ozg2f/)).toBeNull();
  });

  it('strips [ref:...] and shows roadblock icon in DailySiteActivitiesView', () => {
    const mockUpdates = [
      {
        id: 'upd-rb-72',
        plot_id: '72',
        task_template_id: 'task-ceiling',
        task_name: 'งานฝ้าห้องน้ำ',
        user_name: 'VIEW',
        role: 'Foreman',
        action: 'แจ้งติดปัญหา: อื่นๆ (ระบุในหมายเหตุ)',
        text_content:
          'เหตุผล: อื่นๆ (ระบุในหมายเหตุ) (ช่างเข้าวันจันทร์ที่ 16/11/2569) [ref:sub_1794377594294_ozg2f]',
        created_at: new Date().toISOString(),
      },
    ];

    render(
      <DailySiteActivitiesView
        allUpdatesRecord={mockUpdates}
        plots={[{ id: '72', plot_name: '72', project_name: 'ไอลิน6' }]}
      />
    );

    expect(screen.getByText('📝 แจ้งติดปัญหา: อื่นๆ (ระบุในหมายเหตุ)')).toBeDefined();
    expect(
      screen.getByText(/"📝 เหตุผล: อื่นๆ \(ระบุในหมายเหตุ\) \(ช่างเข้าวันจันทร์ที่ 16\/11\/2569\)"/)
    ).toBeDefined();
    expect(screen.queryByText(/\[ref:/)).toBeNull();
  });
});

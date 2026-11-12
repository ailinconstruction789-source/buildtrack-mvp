import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import ForemanWorkspaceView from '../ForemanWorkspaceView';
import DefectProgressView from '../DefectProgressView';
import * as foremanDuty from '@/lib/foremanDuty';
import { buildConstructionLiveFeed } from '@/lib/constructionLiveFeed';

const mockDefectUpdatesHolder = vi.hoisted(() => ({
  rows: [] as any[],
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'defect_updates') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                abortSignal: vi.fn().mockImplementation(async () => ({
                  data: mockDefectUpdatesHolder.rows,
                  error: null,
                })),
              })),
            })),
          })),
        };
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      };
    }),
  },
}));

describe('Handover Inspection integration in Foreman Workspace, DefectProgressView & Live Feed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefectUpdatesHolder.rows = [];
    vi.spyOn(foremanDuty, 'loadForemanDailySnapshot').mockResolvedValue({
      status: 'empty',
      storage: 'remote',
      data: [],
    } as any);
    vi.spyOn(foremanDuty, 'saveForemanDailySnapshot').mockResolvedValue({
      success: true,
      count: 1,
      storage: 'remote',
      isRemoteSynced: true,
    });
  });

  it('displays 🏠 ตรวจรับบ้าน badge, routes to DefectProgressView chat, and logs roadblock via defect_updates', async () => {
    const todayStr = foremanDuty.normalizeDateStr(new Date()) || new Date().toISOString().split('T')[0];

    const plots = [
      { id: 'plot-72', name: 'แปลง 72', project_name: 'ไอลิน 6', foreman_name: 'LEAB', handover_foreman_name: 'VIEW' },
    ];
    const handoverDefect = {
      id: 'def-72-1',
      plot_id: 'plot-72',
      description: 'แก้: สีผนังโถงบันได',
      defect_stage: 'handover',
      handover_cycle: 1,
      inspection_round: 2,
      status: 'in_progress',
      progress: 40,
      planned_start: todayStr,
      planned_end: todayStr,
      foreman_name: 'VIEW',
      contractor_id: 'con-1',
    };
    const contractors = [{ id: 'con-1', name: 'ช่างบอย สีทอง' }];
    const onNavigateToDefectChat = vi.fn();
    const roadblockSpy = vi
      .spyOn(foremanDuty, 'recordForemanTaskRoadblockReason')
      .mockResolvedValue({ success: true });

    render(
      <ForemanWorkspaceView
        plots={plots}
        projects={[{ id: 'proj-1', name: 'ไอลิน 6' }]}
        taskTemplates={[]}
        schedules={{}}
        assignments={[]}
        allUpdatesRecord={[]}
        defects={[handoverDefect]}
        defectUpdates={[]}
        contractors={contractors}
        loggedInUser={{ username: 'VIEW', role: 'Foreman' }}
        currentUserRole="Foreman"
        isForeman={true}
        onNavigateToTaskChat={vi.fn()}
        onNavigateToDefectChat={onNavigateToDefectChat}
      />
    );

    // Renders distinct handover badge + defect task title + contractor
    expect(await screen.findByText(/🏠 ตรวจรับบ้าน/i)).toBeInTheDocument();
    expect(screen.getByText('แก้: สีผนังโถงบันได')).toBeInTheDocument();
    expect(screen.getByText('ช่างบอย สีทอง')).toBeInTheDocument();

    // Clicking update button opens DefectProgressView handler
    const chatBtn = screen.getByRole('button', { name: /ห้องแชท \/ อัปเดต Defect/i });
    fireEvent.click(chatBtn);
    expect(onNavigateToDefectChat).toHaveBeenCalledWith(plots[0], handoverDefect);

    // Adjacent Roadblock button opens reason modal & submits handover roadblock
    const rbBtn = screen.getByTitle('แจ้งเหตุผลไม่เริ่มงาน / ติดปัญหา');
    fireEvent.click(rbBtn);

    expect(screen.getByText(/บันทึกสถานะงานไม่เริ่ม \/ ติดปัญหา/i)).toBeInTheDocument();
    const submitRbBtn = screen.getByRole('button', { name: /บันทึกสถานะงาน/i });
    fireEvent.click(submitRbBtn);

    await waitFor(() => {
      expect(roadblockSpy).toHaveBeenCalledTimes(1);
    });
    expect(roadblockSpy.mock.calls[0][0].is_handover).toBe(true);
    expect(roadblockSpy.mock.calls[0][0].defect_id).toBe('def-72-1');
  });

  it('strips [ref:...] and shows roadblock callout + icon in DefectProgressView & buildConstructionLiveFeed', async () => {
    const plot = { id: 'plot-72', name: 'แปลง 72', project_name: 'ไอลิน 6' };
    const defect = {
      id: 'def-72-1',
      plot_id: 'plot-72',
      description: 'แก้: สีผนังโถงบันได',
      defect_stage: 'handover',
      handover_cycle: 1,
      inspection_round: 1,
      progress: 0,
      status: 'pending',
    };
    const updates = [
      {
        id: 'du-1',
        defect_id: 'def-72-1',
        created_by: 'VIEW',
        progress: 0,
        note: 'เหตุผล: ติดปัญหาช่าง (ขาดช่าง / ช่างไม่เข้างาน) (รอช่างสีเข้าพุธนี้) [ref:sub_999]',
        created_at: '2026-11-12T03:00:00.000Z',
        image_urls: null,
      },
    ];
    mockDefectUpdatesHolder.rows = updates;

    // 1. Live feed mapping preserves action for RoadblockReasonCallout
    const feedItems = buildConstructionLiveFeed({
      allUpdatesRecord: [],
      defectUpdates: updates,
      defects: [defect],
      plots: [plot],
      taskTemplates: [],
      contractors: [],
    });
    const rbFeed = feedItems.find(item => item.id === 'defect-upd-du-1');
    expect(rbFeed).toBeDefined();
    expect(rbFeed?.action).toBe('แจ้งติดปัญหา: ติดปัญหาช่าง (ขาดช่าง / ช่างไม่เข้างาน)');
    expect(rbFeed?.role).toBe('Foreman');

    // 2. DefectProgressView loads history & renders RoadblockReasonCallout cleanly without [ref:...]
    const noopFn = vi.fn();
    const stableDefects = [defect];
    const stableUser = { id: 'u-view', username: 'VIEW' };

    function TestDefectHarness() {
      const [localUpdates, setLocalUpdates] = React.useState<any[]>(updates);
      const [, setLocalProgress] = React.useState<number>(0);
      return (
        <DefectProgressView
          view="defect-progress"
          setView={noopFn}
          defectReturnView="foreman-workspace"
          isMobileLayout={false}
          selectedDefect={defect}
          selectedPlot={plot}
          setProgressValue={setLocalProgress}
          progressValue={0}
          isSending={false}
          setFullImageUrl={noopFn}
          handleDeleteDefectUpdate={noopFn}
          setExportModalOpen={noopFn}
          isProjectPlanner={false}
          isAdmin={false}
          currentUserRole="Foreman"
          updates={localUpdates}
          setUpdates={setLocalUpdates}
          inputText=""
          setInputText={noopFn}
          selectedFiles={[]}
          setSelectedFiles={noopFn}
          isTaskCompleted={false}
          handleOpenExportModal={noopFn}
          defects={stableDefects}
          loggedInUser={stableUser}
          isLockedForForeman={false}
          isSiteEngineer={false}
          isPendingSE={false}
          handleReviewAction={noopFn}
          isQC={false}
          isPendingQC={false}
          isProcurement={false}
          isOwner={false}
          handleSendPost={noopFn}
        />
      );
    }

    render(<TestDefectHarness />);

    expect(await screen.findByText(/เหตุผล: ติดปัญหาช่าง \(ขาดช่าง \/ ช่างไม่เข้างาน\)/)).toBeInTheDocument();
    expect(screen.getByText(/รอช่างสีเข้าพุธนี้/)).toBeInTheDocument();
    expect(screen.queryByText(/\[ref:sub_999\]/)).not.toBeInTheDocument();
  });
});

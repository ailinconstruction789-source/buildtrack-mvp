import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  diffCalendarDays,
  formatThaiShortDate,
  getBangkokDayWindow,
  toBangkokDateString,
} from '../bangkokDate';
import { computeDailySummaryReport, type DailySummaryRawData } from '../dailySummaryData';
import { formatDailySummaryText } from '../dailySummaryFormatter';
import {
  pushLineTextMessage,
  splitLineTextMessages,
  verifyLineSignature,
} from '../lineMessagingClient';
import { GET as cronGet } from '@/app/api/cron/line-daily-summary/route';

function createEmptyRawData(): DailySummaryRawData {
  return {
    projects: [],
    plots: [],
    taskTemplates: [],
    assignments: [],
    schedules: [],
    todayUpdates: [],
    recentUpdatesBeforeToday: [],
    inspectionQueue: [],
    qcInspections: [],
    qcLeaves: [],
    defects: [],
    materialRequests: [],
    leads: [],
    sales: [],
    leadVisits: [],
    customerVoices: [],
  };
}

describe('bangkokDate helpers', () => {
  it('converts UTC timestamps near midnight to Asia/Bangkok calendar date', () => {
    // 2026-11-28T17:30:00Z is 2026-11-29 00:30:00+07:00
    expect(toBangkokDateString('2026-11-28T17:30:00Z')).toBe('2026-11-29');
    // 2026-11-28T12:00:00Z is 2026-11-28 19:00:00+07:00
    expect(toBangkokDateString('2026-11-28T12:00:00Z')).toBe('2026-11-28');
    expect(toBangkokDateString('2026-11-28')).toBe('2026-11-28');
  });

  it('builds Bangkok day window and Thai Buddhist Era short dates', () => {
    const win = getBangkokDayWindow('2026-11-28');
    expect(win.dateStr).toBe('2026-11-28');
    expect(win.monthStartStr).toBe('2026-11-01');
    expect(win.tomorrowStr).toBe('2026-11-29');
    expect(win.plus7DaysStr).toBe('2026-12-05');
    expect(diffCalendarDays('2026-11-28', '2026-12-03')).toBe(5);
    expect(formatThaiShortDate('2026-11-28')).toBe('28 พ.ย. 2569');
    expect(formatThaiShortDate('2026-12-03', false)).toBe('3 ธ.ค.');
  });
});

describe('computeDailySummaryReport & formatDailySummaryText', () => {
  it('aggregates construction, QC, sales, transfers, and alert-only items accurately', () => {
    const raw: DailySummaryRawData = {
      ...createEmptyRawData(),
      projects: [
        { id: 'p1', name: 'ไอลิน 6', is_closed: false, is_external: false },
        { id: 'p2', name: 'บ้านคุณโอ', is_closed: false, is_external: true }, // excluded external
        { id: 'p3', name: 'ไอลิน 2', is_closed: false, is_external: false }, // excluded legacy
        { id: 'p4', name: 'โครงการปิดแล้ว', is_closed: true, is_external: false }, // excluded closed
      ],
      plots: [
        { id: 'A-12', plot_name: 'A-12', project_name: 'ไอลิน 6', house_type_id: 'ht1', is_completed: false, progress: 80, sale_status: 'booked' },
        { id: 'B-04', plot_name: 'B-04', project_name: 'ไอลิน 6', house_type_id: 'ht1', is_completed: true, progress: 100, sale_status: 'transferred' },
        { id: 'EXT-1', plot_name: 'EXT-1', project_name: 'บ้านคุณโอ', house_type_id: 'ht1', is_completed: false, progress: 10 },
      ],
      taskTemplates: [
        { id: 't1', house_type_id: 'ht1', task_name: 'โครงสร้าง', cost: 100, require_qc: true, is_progress_counted: true },
        { id: 't2', house_type_id: 'ht1', task_name: 'สถาปัตย์', cost: 100, require_qc: true, is_progress_counted: true },
      ],
      assignments: [
        { plot_id: 'A-12', task_template_id: 't1', current_progress: 100, is_excluded: false },
        { plot_id: 'A-12', task_template_id: 't2', current_progress: 60, is_excluded: false },
        { plot_id: 'B-04', task_template_id: 't1', current_progress: 100, is_excluded: false },
        { plot_id: 'B-04', task_template_id: 't2', current_progress: 100, is_excluded: false },
      ],
      schedules: [
        { plot_id: 'A-12', task_template_id: 't1', planned_start: '2026-10-01', planned_end: '2026-11-01' },
        { plot_id: 'A-12', task_template_id: 't2', planned_start: '2026-11-01', planned_end: '2026-11-28' }, // 100% planned today -> A-12 is delayed (80% vs 100%)
        { plot_id: 'B-04', task_template_id: 't1', planned_start: '2026-09-01', planned_end: '2026-10-01' },
        { plot_id: 'B-04', task_template_id: 't2', planned_start: '2026-10-01', planned_end: '2026-11-01' },
      ],
      recentUpdatesBeforeToday: [
        // Yesterday A-12 t2 was at 40%, today moved to 60% -> +20% on half of A-12 = +10% on A-12 = +5% overall across 2 plots
        { plot_id: 'A-12', task_template_id: 't2', progress: 40, created_at: '2026-11-27T10:00:00+07:00' },
      ],
      todayUpdates: [
        { plot_id: 'A-12', task_template_id: 't2', progress: 60, action: 'อัปเดตงาน', role: 'Foreman', created_at: '2026-11-28T11:00:00+07:00', is_worker_present: true },
        { plot_id: 'A-12', task_template_id: 't1', progress: 100, action: 'Site Engineer อนุมัติ', role: 'Site Engineer', created_at: '2026-11-28T13:00:00+07:00', is_worker_present: true },
        { plot_id: 'B-04', task_template_id: 't2', progress: 100, action: 'QC อนุมัติผ่าน', role: 'QC', created_at: '2026-11-28T15:00:00+07:00', is_worker_present: false },
      ],
      inspectionQueue: [
        { plot_id: 'A-12', task_template_id: 't1', project_name: 'ไอลิน 6', statusFor: 'QC', created_at: '2026-11-24T10:00:00+07:00' }, // >3 days overdue
        { plot_id: 'A-12', task_template_id: 't2', project_name: 'ไอลิน 6', statusFor: 'QC', created_at: '2026-11-28T13:00:00+07:00' },
      ],
      qcInspections: [
        { id: 'qi1', plot_id: 'A-12', task_template_id: 't1', document_status: 'pending_pe', overall_result: 'conditional', created_at: '2026-11-27T10:00:00+07:00' },
      ],
      qcLeaves: [
        { id: 'lv1', applicant_username: 'qc_somchai', start_date: '2026-11-28', end_date: '2026-11-29', status: 'approved' },
      ],
      defects: [
        { id: 'd1', plot_id: 'A-12', status: 'open', created_at: '2026-11-25T10:00:00+07:00' },
        { id: 'd2', plot_id: 'A-12', status: 'in_progress', created_at: '2026-11-26T10:00:00+07:00' },
        { id: 'd3', plot_id: 'B-04', status: 'resolved', created_at: '2026-11-20T10:00:00+07:00' },
      ],
      materialRequests: [
        { id: 'm1', plot_id: 'A-12', status: 'requested', requested_at: '2026-11-28T09:00:00+07:00' },
      ],
      leads: [
        {
          id: 'l1',
          project_name: 'ไอลิน 6',
          customer_name: 'คุณสมชาย',
          status: 'Booked',
          crm_status: 'Booked — จองแล้ว',
          lead_date: '2026-11-28T09:00:00+07:00',
          contacted_date: '2026-11-28T09:30:00+07:00',
          actual_visit_date: '2026-11-28T14:00:00+07:00',
          booking_date: '2026-11-28T16:00:00+07:00',
          interested_plot_id: 'A-12',
        },
        {
          id: 'l2',
          project_name: 'ไอลิน 6',
          customer_name: 'คุณสมหญิง',
          status: 'New',
          crm_status: 'Follow-up — อยู่ระหว่างติดตาม',
          lead_date: '2026-11-26T09:00:00+07:00', // >24h uncontacted -> SLA breach
          contacted_date: null,
        },
        {
          id: 'l3',
          project_name: 'ไอลิน 6',
          customer_name: 'คุณวิชัย',
          status: 'Transferred',
          crm_status: 'Transferred / Won — โอนกรรมสิทธิ์สำเร็จ',
          lead_date: '2026-11-05T09:00:00+07:00',
          contacted_date: '2026-11-05T10:00:00+07:00',
          booking_date: '2026-11-10T10:00:00+07:00',
          transferred_date: '2026-11-28T11:00:00+07:00',
          interested_plot_id: 'B-04',
        },
      ],
      sales: [
        {
          id: 's1',
          lead_id: 'l1',
          plot_id: 'A-12',
          contract_status: 'Reserved',
          bank_status: 'Approved',
          expected_transfer_date: '2026-12-03', // in 5 days
          created_at: '2026-11-28T16:00:00+07:00',
        },
        {
          id: 's2',
          lead_id: 'l3',
          plot_id: 'B-04',
          contract_status: 'Transferred',
          bank_status: 'Approved',
          expected_transfer_date: '2026-11-28',
          transferred_at: '2026-11-28T11:00:00+07:00',
          created_at: '2026-11-10T10:00:00+07:00',
        },
      ],
      leadVisits: [
        { id: 'v1', lead_id: 'l1', project_name: 'ไอลิน 6', visited_at: '2026-11-28T14:00:00+07:00' }, // duplicate of l1 actual_visit_date
        { id: 'v2', lead_id: 'l99', project_name: 'ไอลิน 6', visited_at: '2026-11-28T15:00:00+07:00' }, // distinct visit
      ],
      customerVoices: [
        { id: 'cv1', project_name: 'ไอลิน 6', survey_date: '2026-11-28T15:00:00+07:00', score_average: 2.8 },
      ],
    };

    const report = computeDailySummaryReport(raw, {
      reportDate: '2026-11-28',
      appUrl: 'https://buildtrack.vercel.app',
    });

    // Only ไอลิน 6 included (external, legacy, closed excluded)
    expect(report.projectsConstruction).toHaveLength(1);
    expect(report.projectsConstruction[0].projectName).toBe('ไอลิน 6');

    // Construction progress: A-12 is 80%, B-04 is 100% -> overall 90% vs 100% planned -> -10% variance, +5% today
    expect(report.overallConstruction.actualProgressPct).toBeCloseTo(90, 1);
    expect(report.overallConstruction.plannedProgressPct).toBeCloseTo(100, 1);
    expect(report.overallConstruction.variancePct).toBeCloseTo(-10, 1);
    expect(report.overallConstruction.todayDeltaPct).toBeCloseTo(5, 1);
    expect(report.overallConstruction.delayedPlots).toBe(1);
    expect(report.overallConstruction.plotsWithWorkersToday).toBe(1);
    expect(report.overallConstruction.plotsWithoutWorkersToday).toBe(1);

    // QC metrics
    expect(report.overallConstruction.qcEnteredToday).toBe(1);
    expect(report.overallConstruction.qcInspectedToday).toBe(1);
    expect(report.overallConstruction.qcPassedToday).toBe(1);
    expect(report.overallConstruction.qcBacklogTotal).toBe(2);
    expect(report.overallConstruction.qcBacklogOverdue3Days).toBe(1);
    expect(report.overallConstruction.pePendingCount).toBe(1);

    // Sales metrics
    expect(report.sales.leadsToday).toBe(1);
    expect(report.sales.visitsToday).toBe(2); // l1 deduplicated + l99 from lead_visits
    expect(report.sales.bookingsToday).toBe(1);
    expect(report.sales.bookingsMtd).toBe(2);
    expect(report.sales.transfersMtd).toBe(1);
    expect(report.sales.slaBreachCount).toBe(1);
    expect(report.sales.transfersToday).toHaveLength(1);
    expect(report.sales.transfersToday[0].plotLabel).toBe('B-04');
    expect(report.sales.transfersToday[0].isTransferredToday).toBe(true);
    expect(report.sales.upcomingTransfers7Days).toHaveLength(1);
    expect(report.sales.upcomingTransfers7Days[0].plotLabel).toBe('A-12');
    expect(report.sales.upcomingTransfers7Days[0].openDefectsCount).toBe(2);

    // Alerts
    expect(report.urgentAlerts.map((a) => a.category)).toEqual(
      expect.arrayContaining(['defect_transfer', 'material_request', 'qc_leave', 'customer_voice']),
    );

    const text = formatDailySummaryText(report);
    expect(text).toContain('📊 สรุปรายวัน BuildTrack | 28 พ.ย. 2569 (19:00 น.)');
    expect(text).toContain('🏗️ ฝั่งก่อสร้าง (ไอลิน 6)');
    expect(text).toContain('ความก้าวหน้าวันนี้: +5% | สะสม: 90% (แผน 100% | -10% 🔴)');
    expect(text).toContain('QC ค้างสะสม: 2 งาน (ค้าง >3 วัน: 1 | รอ PE: 1)');
    expect(text).toContain('แปลง A-12 (ไอลิน 6) ค้างแก้ Defect 2 รายการ (นัดโอนใน 5 วัน)');
    expect(text).toContain('💼 ฝั่งขาย (ไอลิน 6)');
    expect(text).toContain('Lead ใหม่ 1 | เข้าชม 2 | จอง 1');
    expect(text).toContain('คงเหลือยังไม่โอน: 1 แปลง (ไอลิน 6: 1)');
    expect(text).toContain('ค้างติดตาม (ยังไม่ติดต่อ >24 ชม.): 1 ราย');
    expect(text).toContain('แปลง B-04 (คุณวิชัย): โอนสำเร็จ ✅');
    expect(text).toContain('แปลง A-12 (3 ธ.ค.): รอแก้ Defect 2 รายการ, งานก่อสร้าง 80%');
    expect(text).toContain('🔗 ดูรายละเอียดเพิ่มเติม: https://buildtrack.vercel.app');
  });

  it('scopes construction to ไอลิน 6+ while aggregating sales across all open projects with remaining stock (excluding external sites)', () => {
    const raw: DailySummaryRawData = {
      ...createEmptyRawData(),
      projects: [
        { name: 'ไอลิน6', is_closed: false, is_external: false },
        { name: 'ไอลิน 4', is_closed: false, is_external: false }, // open with remaining stock -> included in sales, excluded in construction
        { name: 'โยริว', is_closed: false, is_external: false },   // open with remaining stock -> included in sales, excluded in construction
        { name: 'ไอลิน 2', is_closed: true, is_external: false },  // closed -> excluded from both
        { name: 'บ้านคุณโอ', is_closed: false, is_external: true }, // external -> excluded from both
      ],
      plots: [
        { id: 'A6-1', plot_name: 'A-01', project_name: 'ไอลิน6', house_type_id: 'ht1', is_completed: false },
        { id: 'A6-2', plot_name: 'A-02', project_name: 'ไอลิน6', house_type_id: 'ht1', is_completed: false },
        { id: 'A4-1', plot_name: 'C-09', project_name: 'ไอลิน 4', house_type_id: 'ht1', is_completed: false },
        { id: 'A4-2', plot_name: 'C-10', project_name: 'ไอลิน 4', house_type_id: 'ht1', is_completed: true },
        { id: 'YR-1', plot_name: 'Y-01', project_name: 'โยริว', house_type_id: 'ht1', is_completed: false },
        { id: 'A2-1', plot_name: 'OLD-1', project_name: 'ไอลิน 2', house_type_id: 'ht1', is_completed: true },
        { id: 'EXT-1', plot_name: 'O-01', project_name: 'บ้านคุณโอ', house_type_id: 'ht1', is_completed: false },
      ],
      taskTemplates: [
        { id: 't1', house_type_id: 'ht1', task_name: 'โครงสร้าง', cost: 100, is_progress_counted: true },
      ],
      assignments: [
        { plot_id: 'A6-1', task_template_id: 't1', current_progress: 50 },
        { plot_id: 'A6-2', task_template_id: 't1', current_progress: 50 },
        { plot_id: 'A4-1', task_template_id: 't1', current_progress: 100 }, // should NOT affect construction average (50%)
        { plot_id: 'YR-1', task_template_id: 't1', current_progress: 100 },
      ],
      defects: [
        { id: 'd-a4', plot_id: 'A4-1', status: 'open', created_at: '2026-11-27T10:00:00+07:00' },
      ],
      leads: [
        // Space variant 'ไอลิน 6' should match 'ไอลิน6'
        { id: 'l-a6', project_name: 'ไอลิน 6', customer_name: 'ลูกค้าไอลิน6', lead_date: '2026-11-28T10:00:00+07:00', contacted_date: '2026-11-28T10:30:00+07:00' },
        { id: 'l-a4', project_name: 'ไอลิน 4', customer_name: 'ลูกค้าไอลิน4', lead_date: '2026-11-28T11:00:00+07:00', contacted_date: '2026-11-28T11:10:00+07:00', actual_visit_date: '2026-11-28T13:00:00+07:00' },
        { id: 'l-yr', project_name: 'โยริว', customer_name: 'ลูกค้าโยริว', lead_date: '2026-11-28T12:00:00+07:00', contacted_date: '2026-11-28T12:10:00+07:00' },
        // External project lead MUST be excluded
        { id: 'l-ext', project_name: 'บ้านคุณโอ', customer_name: 'ลูกค้างานนอก', lead_date: '2026-11-28T12:00:00+07:00' },
      ],
      sales: [
        {
          id: 's-a4',
          lead_id: 'l-a4',
          plot_id: 'A4-1',
          contract_status: 'Contracted',
          bank_status: 'Approved',
          expected_transfer_date: '2026-11-30', // in 2 days on ไอลิน 4
          created_at: '2026-11-15T10:00:00+07:00',
        },
      ],
    };

    const report = computeDailySummaryReport(raw, { reportDate: '2026-11-28' });

    // Construction scope: ONLY ไอลิน6 (progress = 50%, not polluted by ไอลิน 4 / โยริว)
    expect(report.projectsConstruction.map((p) => p.projectName)).toEqual(['ไอลิน6']);
    expect(report.overallConstruction.totalPlots).toBe(2);
    expect(report.overallConstruction.actualProgressPct).toBeCloseTo(50, 1);

    // Sales scope: ไอลิน6 (2), โยริว (1), ไอลิน 4 (1) — excludes บ้านคุณโอ & ไอลิน 2 (sorted by remaining desc, then Thai collation)
    expect(report.sales.includedProjects.map((p) => p.projectName)).toEqual(['ไอลิน6', 'โยริว', 'ไอลิน 4']);
    expect(report.sales.totalRemainingPlots).toBe(4);
    expect(report.sales.leadsToday).toBe(3); // ไอลิน6 + ไอลิน 4 + โยริว (not บ้านคุณโอ)
    expect(report.sales.visitsToday).toBe(1);
    expect(report.sales.upcomingTransfers7Days).toHaveLength(1);
    expect(report.sales.upcomingTransfers7Days[0].projectName).toBe('ไอลิน 4');
    expect(report.sales.upcomingTransfers7Days[0].openDefectsCount).toBe(1);

    // Defect alert on upcoming ไอลิน 4 transfer should be surfaced
    expect(report.urgentAlerts.some((a) => a.message.includes('C-09') && a.message.includes('ไอลิน 4'))).toBe(true);

    const text = formatDailySummaryText(report);
    expect(text).toContain('🏗️ ฝั่งก่อสร้าง (ไอลิน6)');
    expect(text).toContain('💼 ฝั่งขาย (รวม 3 โครงการที่ยังเปิดขาย)');
    expect(text).toContain('คงเหลือยังไม่โอน: 4 แปลง (ไอลิน6: 2 | โยริว: 1 | ไอลิน 4: 1)');
    expect(text).toContain('[ไอลิน 4] แปลง C-09 (30 พ.ย.): รอแก้ Defect 1 รายการ');
    expect(text).not.toContain('บ้านคุณโอ');
  });

  it('omits alert-only sections when counts are zero', () => {
    const raw: DailySummaryRawData = {
      ...createEmptyRawData(),
      projects: [{ id: 'p1', name: 'ไอลิน 6', is_closed: false, is_external: false }],
      plots: [{ id: 'P-1', plot_name: 'P-1', project_name: 'ไอลิน 6', house_type_id: 'ht1', is_completed: false, progress: 50 }],
    };

    const report = computeDailySummaryReport(raw, { reportDate: '2026-11-28' });
    const text = formatDailySummaryText(report);

    expect(text).not.toContain('⚠️');
    expect(text).not.toContain('ค้างติดตาม');
    expect(text).not.toContain('โอน / คาดการณ์โอนวันนี้');
    expect(text).not.toContain('คาดการณ์โอนใน 7 วัน');
    expect(text).not.toContain('📣');
  });
});

describe('lineMessagingClient', () => {
  it('verifies valid and rejects invalid LINE HMAC-SHA256 signatures', () => {
    const body = JSON.stringify({ events: [] });
    const secret = 'test_channel_secret_123';
    const validSig = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64');

    expect(verifyLineSignature(body, validSig, secret)).toBe(true);
    expect(verifyLineSignature(body, 'invalid_signature', secret)).toBe(false);
    expect(verifyLineSignature(body, null, secret)).toBe(false);
  });

  it('splits long text cleanly at newline boundaries', () => {
    const longText = Array.from({ length: 10 }, (_, i) => `Line ${i}: ${'x'.repeat(20)}`).join('\n');
    const chunks = splitLineTextMessages(longText, 90);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(90);
    }
  });

  it('pushes text messages with Bearer authorization header', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const res = await pushLineTextMessage({
      channelAccessToken: 'tok_abc',
      to: 'Cgroup123',
      text: 'Hello BuildTrack',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(res.ok).toBe(true);
    expect(res.messageCount).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.line.me/v2/bot/message/push');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok_abc');
    expect(JSON.parse(init.body)).toEqual({
      to: 'Cgroup123',
      messages: [{ type: 'text', text: 'Hello BuildTrack' }],
    });
  });
});

describe('cron API route auth guard', () => {
  it('rejects unauthorized requests when CRON_SECRET is set', async () => {
    const prevSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'super_secret_cron_key';
    try {
      const req = new Request('https://example.com/api/cron/line-daily-summary');
      const res = await cronGet(req);
      expect(res.status).toBe(401);

      const badDateReq = new Request(
        'https://example.com/api/cron/line-daily-summary?date=invalid-date',
        { headers: { Authorization: 'Bearer super_secret_cron_key' } },
      );
      const badDateRes = await cronGet(badDateReq);
      expect(badDateRes.status).toBe(400);
    } finally {
      if (prevSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prevSecret;
    }
  });
});

import { describe, expect, it } from 'vitest';
import { buildConstructionLiveFeed, type ConstructionLiveFeedInput } from '../constructionLiveFeed';

// The former app/page.tsx calculation. Synthetic fixtures only; no database or browser calls.
function legacyLiveFeed(input: ConstructionLiveFeedInput) {
  const { allUpdatesRecord = [], taskTemplates = [], defectUpdates = [], defects = [], contractors = [], plots = [] } = input;
  const items: any[] = [];
  (allUpdatesRecord || []).filter(u => !u.is_silent).forEach(u => {
    const task = taskTemplates!.find(t => t.id === u.task_template_id);
    const isHandoverTask = Boolean((task?.task_name && task.task_name.includes('ตรวจรับ')) ||
      (typeof u.action === 'string' && u.action.includes('ตรวจรับ')) || u.is_handover);
    items.push({ ...u, id: u.id, task_name: task ? task.task_name : (u.action || 'งานก่อสร้าง'),
      is_handover: isHandoverTask, feed_category: isHandoverTask ? 'handover' : 'construction' });
  });
  (defectUpdates || []).forEach(du => {
    const defect = (defects || []).find(d => d.id === du.defect_id);
    if (defect) {
      const task = taskTemplates!.find(t => t.id === (defect.task_template_id || defect.task_id));
      const contractor = (contractors || []).find(c => String(c.id) === String(defect.contractor_id));
      const isCompleted = du.progress === 100;
      items.push({
        id: `defect-upd-${du.id}`, defect, plot_id: defect.plot_id,
        task_template_id: defect.task_template_id || defect.task_id,
        task_name: defect.description || task?.task_name || 'งานแก้ไขตรวจรับมอบบ้าน',
        user_name: du.created_by || 'ช่างผู้รับเหมา',
        role: du.created_by && du.created_by.includes('QC') ? 'QC' : (du.created_by && du.created_by.includes('Foreman') ? 'Foreman' : 'ช่างซ่อม/ผู้รับเหมา'),
        action: isCompleted ? 'แก้ไข Defect เสร็จสิ้น 100%' : `อัปเดตงานแก้ไข Defect (${du.progress}%)`,
        text_content: du.note || `อัปเดตความคืบหน้า ${du.progress}%`, progress: du.progress || 0,
        is_completed: isCompleted, image_url: du.image_urls, created_at: du.created_at,
        is_handover: true, handover_round: defect.inspection_round, handover_cycle: defect.handover_cycle,
        defect_description: defect.description, contractor_name: contractor ? contractor.name : null, feed_category: 'handover',
      });
    }
  });
  (defects || []).filter(d => d.defect_stage === 'handover').forEach(d => {
    const task = taskTemplates!.find(t => t.id === (d.task_template_id || d.task_id));
    const contractor = (contractors || []).find(c => String(c.id) === String(d.contractor_id));
    items.push({
      id: `defect-init-${d.id}`, defect: d, plot_id: d.plot_id, task_template_id: d.task_template_id || d.task_id,
      task_name: d.description || task?.task_name || 'แจ้งรายการตรวจรับมอบบ้าน',
      user_name: d.reported_by || d.reporter_name || 'ผู้ตรวจรับมอบบ้าน', role: 'ตรวจรับมอบบ้าน',
      action: `บันทึกรายการตรวจรับบ้าน (รอบที่ ${d.inspection_round || 1})`,
      text_content: d.description || 'พบรายการที่ต้องแก้ไขในการตรวจรับมอบบ้าน', progress: d.progress || 0,
      is_completed: d.progress === 100, image_url: d.image_url, created_at: d.created_at,
      is_handover: true, handover_round: d.inspection_round, handover_cycle: d.handover_cycle,
      contractor_name: contractor ? contractor.name : null, feed_category: 'handover',
    });
  });
  (plots || []).filter(p => p.handover_status === 'completed' && p.handover_completed_at).forEach(p => {
    items.push({ id: `plot-handover-done-${p.id}`, plot_id: p.id, task_name: 'ตรวจรับมอบบ้านสำเร็จสมบูรณ์',
      user_name: p.handover_completed_by || 'Admin', role: 'ผู้มีอำนาจอนุมัติ', action: '🏆 อนุมัติผ่านและปิดการตรวจรับมอบบ้าน',
      text_content: `แปลง ${p.id} ผ่านการตรวจรับมอบบ้านเรียบร้อยแล้วทุกรายการ ส่งมอบบ้านสำเร็จ`,
      progress: 100, is_completed: true, created_at: p.handover_completed_at, is_handover: true,
      is_handover_completed: true, handover_round: p.inspection_round, feed_category: 'handover' });
  });
  return items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

const timestamp = '2026-10-08T10:00:00Z';
const base: ConstructionLiveFeedInput = {
  taskTemplates: [{ id: 1, task_name: 'Normal first' }, { id: 1, task_name: 'Duplicate ignored' },
    { id: '1', task_name: 'ตรวจรับบ้าน' }, { id: 0, task_name: 'Zero task' }, { id: 2 }],
  allUpdatesRecord: [
    { id: 'normal', task_template_id: 1, created_at: timestamp, action: 'Report', role: 'Foreman', extra: 'retain' },
    { id: 'handover-task', task_template_id: '1', created_at: timestamp, action: 'Report' },
    { id: 'handover-action', task_template_id: 1, created_at: timestamp, action: 'ตรวจรับครั้งแรก' },
    { id: 'handover-flag', task_template_id: 1, created_at: timestamp, is_handover: true },
    { id: 'silent', task_template_id: 1, created_at: timestamp, is_silent: true },
  ],
  defects: [{ id: 7, plot_id: 'A', task_template_id: 1, description: 'Description wins', contractor_id: '9',
    defect_stage: 'handover', reported_by: 'Reporter', inspection_round: 2, handover_cycle: 3, progress: 100, created_at: timestamp },
    { id: 7, plot_id: 'B', task_template_id: '1', defect_stage: 'construction', description: 'Duplicate defect ignored for updates', created_at: timestamp },
    { id: '7', plot_id: 'C', task_id: '1', contractor_id: 9, defect_stage: 'handover', reporter_name: 'Fallback reporter', created_at: timestamp }],
  defectUpdates: [{ id: 10, defect_id: 7, progress: 100, created_by: 'QC Foreman', note: 'Repair note', image_urls: ['fixture.jpg'], created_at: timestamp },
    { id: 11, defect_id: '7', progress: '100', created_by: 'Foreman Test', created_at: timestamp },
    { id: 12, defect_id: 'missing', progress: 100, created_at: timestamp }],
  contractors: [{ id: 9, name: 'First contractor' }, { id: '9', name: 'Duplicate ignored' }],
  plots: [{ id: 'A', handover_status: 'completed', handover_completed_at: timestamp, handover_completed_by: 'Approver', inspection_round: 2 },
    { id: 'B', handover_status: 'pending', handover_completed_at: timestamp },
    { id: 'C', handover_status: 'completed', handover_completed_at: null }],
};

describe('construction live feed (synthetic parity)', () => {
  it('matches the complete old feed and preserves equal-time category/source ordering', () => {
    const result = buildConstructionLiveFeed(base);
    expect(result).toEqual(legacyLiveFeed(base));
    expect(result.map(item => item.id)).toEqual(['normal', 'handover-task', 'handover-action', 'handover-flag',
      'defect-upd-10', 'defect-upd-11', 'defect-init-7', 'defect-init-7', 'plot-handover-done-A']);
    expect(result[0].task_name).toBe('Normal first'); expect(result[0].extra).toBe('retain');
    expect(result[4].defect).toBe(base.defects![0]); expect(result[4].contractor_name).toBe('First contractor');
    expect(result[4].role).toBe('QC'); expect(result[4].is_completed).toBe(true);
    expect(result[5].role).toBe('Foreman'); expect(result[5].is_completed).toBe(false);
  });
  it.each([undefined, null, '', 0, false, 'Custom action'])('matches task/action fallback semantics %j', action => {
    const input = { ...base, allUpdatesRecord: [{ id: 'fallback', created_at: timestamp, action },
      { id: 'nameless-template', task_template_id: 2, created_at: timestamp, action: 'Must not replace absent template name' }] };
    expect(buildConstructionLiveFeed(input)).toEqual(legacyLiveFeed(input));
  });
  it.each([undefined, null, 0, '0', false, 100, '100'])('preserves strict completion, role/name/round fallbacks and falsy task id %j', progress => {
    const input = { ...base,
      defects: [{ id: 'D', plot_id: 'P', task_template_id: 0, task_id: '1', defect_stage: 'handover',
        progress, inspection_round: 0, created_at: timestamp, reported_by: '', reporter_name: '' }],
      defectUpdates: [{ id: 'DU', defect_id: 'D', progress, created_by: '', note: '', created_at: timestamp }],
      plots: [{ id: 'P', handover_status: 'completed', handover_completed_at: timestamp, handover_completed_by: '' }],
    };
    expect(buildConstructionLiveFeed(input)).toEqual(legacyLiveFeed(input));
  });
  it.each(['2026-01-01', '2027-01-01', 'invalid', undefined, null])('matches sorting with changed or invalid timestamp %j', created_at => {
    const input = { ...base, allUpdatesRecord: [...base.allUpdatesRecord!, { id: 'changed-time', created_at, action: 'Report' }] };
    expect(buildConstructionLiveFeed(input)).toEqual(legacyLiveFeed(input));
  });
  it('keeps strict identifier semantics including NaN never matching, null, undefined and object identity', () => {
    const idObject = {};
    const input: ConstructionLiveFeedInput = {
      taskTemplates: [{ id: NaN, task_name: 'NaN must not match' }, { id: null, task_name: 'Null task' },
        { task_name: 'Undefined task' }, { id: idObject, task_name: 'Object task' }],
      allUpdatesRecord: [NaN, null, undefined, idObject, {}].map((id, index) => ({ id: index, task_template_id: id, created_at: timestamp })),
      defects: [{ id: NaN, defect_stage: 'handover', created_at: timestamp }],
      defectUpdates: [{ id: 'NaN', defect_id: NaN, created_at: timestamp }],
    };
    expect(buildConstructionLiveFeed(input)).toEqual(legacyLiveFeed(input));
  });
  it('supports empty or nullable optional sources and never mutates frozen input rows/arrays', () => {
    expect(buildConstructionLiveFeed({})).toEqual([]);
    expect(buildConstructionLiveFeed({ allUpdatesRecord: null, defectUpdates: null, defects: null, contractors: null, plots: null })).toEqual([]);
    const snapshot = JSON.stringify(base);
    const frozen = Object.fromEntries(Object.entries(base).map(([key, rows]) => [key,
      Object.freeze((rows as object[]).map(row => Object.freeze({ ...row })))]));
    expect(buildConstructionLiveFeed(frozen)).toEqual(legacyLiveFeed(base));
    expect(JSON.stringify(base)).toBe(snapshot);
  });
  it('reads lookup IDs once per source row instead of scanning tasks per update', () => {
    let reads = 0;
    const tasks = Array.from({ length: 300 }, (_, id) => ({ get id() { reads++; return id; }, task_name: `Task ${id}` }));
    const updates = Array.from({ length: 200 }, (_, id) => ({ id, task_template_id: 299, created_at: timestamp }));
    const result = buildConstructionLiveFeed({ taskTemplates: tasks, allUpdatesRecord: updates });
    expect(result).toHaveLength(200);
    expect(reads).toBe(300);
  });
});

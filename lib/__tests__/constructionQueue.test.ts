import { describe, expect, it } from 'vitest';
import { constructionQueueBillingPartition, constructionQueueDate, constructionQueueHistoryIndex, constructionQueueKey } from '../constructionQueue';

describe('construction queue history', () => {
  const submit = { plot_id: 'A', task_template_id: 'T', created_at: '2026-10-08T09:00:00Z', progress: 100, action: 'ส่งงาน 100%' };
  const review = { ...submit, created_at: '2026-10-08T09:05:00Z', action: 'QC อนุมัติผ่าน' };

  it('pairs reviews with the latest preceding submission regardless of input order', () => {
    const future = { ...submit, created_at: '2026-10-08T09:07:00Z' };
    const older = { ...submit, created_at: '2026-10-08T08:00:00Z' };
    for (const rows of [[review, submit, older, future], [older, future, review, submit], [submit, review, future, older]]) {
      expect(constructionQueueHistoryIndex(rows).previousSubmission(review)).toBe(submit);
    }
  });

  it('preserves strict earlier-than semantics for daily detail and supports zero-minute suspect approvals', () => {
    const sameTime = { ...submit, created_at: review.created_at };
    const history = constructionQueueHistoryIndex([sameTime, review, submit]);
    expect(history.previousSubmission(review)).toBe(submit);
    expect(history.previousSubmission(review, true)).toBe(sameTime);
  });

  it('preserves first source submission on timestamp ties and excludes invalid dates/QC actions', () => {
    const duplicate = { ...submit };
    const invalid = { ...submit, created_at: 'bad' };
    const qc = { ...submit, created_at: '2026-10-08T09:04:00Z', action: 'QC แจ้งแก้ไข' };
    const history = constructionQueueHistoryIndex([duplicate, submit, invalid, qc, review]);
    expect(history.previousSubmission(review)).toBe(duplicate);
    expect(history.previousSubmission({ ...review, created_at: 'bad' })).toBeUndefined();
  });

  it('normalizes IDs without colliding delimiter-containing plot/task pairs or mutating history', () => {
    const a = { ...submit, plot_id: 'A_B', task_template_id: 'C' };
    const b = { ...submit, plot_id: 'A', task_template_id: 'B_C' };
    const rows = Object.freeze([a, b]);
    const history = constructionQueueHistoryIndex(rows);
    expect(history.grouped.size).toBe(2);
    expect(history.previousSubmission({ ...review, plot_id: 'A_B', task_template_id: 'C' })).toBe(a);
    expect(rows).toEqual([a, b]);
    expect(constructionQueueKey(7, 1)).toBe(constructionQueueKey('7', '1'));
  });

  it('matches the former daily-detail filter/sort for ordinary valid histories', () => {
    const rows = Array.from({ length: 45 }, (_, index) => ({
      plot_id: index % 2 ? 'A' : 'B', task_template_id: 'T', progress: index % 3 ? 100 : 20,
      action: index % 4 ? 'ส่งงาน 100%' : 'QC อนุมัติ',
      created_at: new Date(Date.UTC(2026, 9, 8, 1, index)).toISOString(),
    })).reverse();
    const history = constructionQueueHistoryIndex(rows);
    for (const row of rows) {
      const previous = rows.filter(candidate => String(candidate.plot_id) === String(row.plot_id) &&
        String(candidate.task_template_id) === String(row.task_template_id) &&
        new Date(candidate.created_at) < new Date(row.created_at) && candidate.progress === 100 &&
        (candidate.action === 'ส่งงาน 100%' || !candidate.action.includes('QC')))
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
      expect(history.previousSubmission(row)).toBe(previous);
    }
  });
});

describe('billing partition and local dates', () => {
  it('preserves approval rules, strict template IDs, first duplicate, UTC cutoff, totals and row order', () => {
    const templates = [{ id: 1, require_qc: true }, { id: '1', require_qc: false }, { id: 1, require_qc: false }];
    const rows = [
      { task_template_id: 1, latest_action: 'Site Engineer อนุมัติ', task_cost: 999 },
      { task_template_id: '1', latest_action: 'Site Engineer อนุมัติ', latest_update_created_at: '2026-07-04T00:00:00Z', task_cost: '10' },
      { task_template_id: 1, latest_action: 'QC อนุมัติผ่าน', latest_update_created_at: '2026-07-03T23:59:59Z', task_cost: 20 },
      { task_template_id: 2, latest_action: 'QC อนุมัติ', latest_update_created_at: 'bad', task_cost: 30 },
      { task_template_id: 2, latest_action: 'QC อนุมัติ', billing_status: 'billed', task_cost: '40' },
      { task_template_id: 2, latest_action: 'QC แจ้งแก้ไข', billing_status: 'billed', task_cost: 999 },
      { task_template_id: 2, latest_action: 'QC อนุมัติ', latest_update_created_at: null, task_cost: 5 },
    ];
    expect(constructionQueueBillingPartition(rows, templates)).toEqual({
      pendingItems: [rows[1], rows[3]], billedItems: [rows[2], rows[4], rows[6]],
      totalPendingValue: 40, totalBilledValue: 65,
    });
  });

  it('uses local calendar fields rather than UTC for the initial QC filter', () => {
    const midnight = new Date(2026, 9, 9, 0, 15);
    expect(constructionQueueDate(midnight)).toBe('2026-10-09');
    expect(constructionQueueDate(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });
});

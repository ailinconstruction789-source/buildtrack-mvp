import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import VisitSopForm from '../VisitSopForm';
import { sopId, sopRun, sopSnapshot } from '@/lib/sales/__tests__/visitSopFixtures';
import { VISIT_SOP_TEMPLATE, type VisitSopSnapshot } from '@/lib/sales/visitSopContracts';
afterEach(cleanup);
function setup(snapshot = sopSnapshot(), disabled = false) { const save = vi.fn(); render(<VisitSopForm snapshot={snapshot} disabled={disabled} onSubmit={save} />); return save; }
function evidence() {
  fireEvent.change(screen.getByLabelText('วันเวลาที่ทำรายการจริง (กรุงเทพฯ) *'), { target: { value: '2026-09-24T12:00:00' } });
  fireEvent.change(screen.getByLabelText('เหตุผล / บันทึกการทำงานครั้งนี้ *'), { target: { value: 'ทำงานตามจริง' } });
}
const submit = () => fireEvent.submit(screen.getByRole('form', { name: 'บันทึก SOP พาชม' }));
function stageSnapshot(stage: 'stage_a' | 'stage_b' | 'stage_c') {
  const snapshot = sopSnapshot(); snapshot.run = sopRun(stage);
  if (stage === 'stage_c') snapshot.anchor = { ...snapshot.anchor, visitId: sopId(4), visitStatus: 'awaiting_voice', checkedInAt: '2026-09-24T02:30:00Z' };
  return snapshot;
}
describe('evidence-based SOP form', () => {
  it('starts with blank actual time and tourhouse; selection never reserves or changes interested plot', () => {
    const save = setup(); expect(screen.getByLabelText('วันเวลาที่ทำรายการจริง (กรุงเทพฯ) *')).toHaveValue(''); expect(screen.getByLabelText('บ้าน / แปลงที่จะพาชม *')).toHaveValue('');
    evidence(); submit(); expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('บ้าน / แปลงที่จะพาชม *'), { target: { value: 'SYNTHETIC-HOUSE' } }); submit();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ command: 'start', plotId: 'SYNTHETIC-HOUSE', occurredAt: '2026-09-24T12:00:00+07:00', appointmentId: sopId(3), visitId: null }));
    expect(save.mock.calls[0][0]).not.toHaveProperty('interestedPlotId'); expect(screen.getByText(/ทุกสถานะ รวมบ้านตัวอย่าง/)).toBeInTheDocument();
  });
  it('supports text search across provided project plots, not vacant stock filtering', () => {
    const snapshot = sopSnapshot(); snapshot.plots.push({ id: 'MODEL-OCCUPIED', name: 'บ้านตัวอย่าง B' }); snapshot.plotsHasMore = true; setup(snapshot);
    fireEvent.change(screen.getByLabelText('ค้นหาบ้าน / แปลงสำหรับพาชม'), { target: { value: 'MODEL' } });
    expect(screen.getByRole('option', { name: /MODEL-OCCUPIED/ })).toBeInTheDocument(); expect(screen.queryByRole('option', { name: /SYNTHETIC-HOUSE/ })).not.toBeInTheDocument();
    expect(screen.getByText(/200 บ้าน/)).toBeInTheDocument();
  });
  it('initially leaves all 16 Stage A answers pending and saves partial work without manufacturing completion', () => {
    const save = setup(stageSnapshot('stage_a')); for (const [, label] of VISIT_SOP_TEMPLATE.stage_a) expect(screen.getByLabelText(label)).toHaveValue('pending');
    expect(screen.queryByRole('button', { name: /ทั้งหมด|ครบทุกข้อ/ })).not.toBeInTheDocument(); evidence(); submit();
    expect(save.mock.calls[0][0]).toMatchObject({ command: 'save_stage', stage: 'stage_a', recap: null, answers: VISIT_SOP_TEMPLATE.stage_a.map(([key]) => ({ key, result: 'pending', reason: null })) });
  });
  it.each(['not_applicable', 'skipped'])('requires each %s answer own reason, not just the overall reason', result => {
    const save = setup(stageSnapshot('stage_a')); evidence(); const label = VISIT_SOP_TEMPLATE.stage_a[0][1];
    fireEvent.change(screen.getByLabelText(label), { target: { value: result } }); submit(); expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(`เหตุผล: ${label}`), { target: { value: 'ไม่มีพื้นที่นี้' } }); submit();
    expect(save.mock.calls[0][0].answers[0]).toEqual({ key: VISIT_SOP_TEMPLATE.stage_a[0][0], result, reason: 'ไม่มีพื้นที่นี้' });
  });
  it('requires all answers for Stage A completion and never exposes a manual Visit-complete control', () => {
    const save = setup(stageSnapshot('stage_a')); evidence(); fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน Stage A ครบและไป Stage B' })); expect(save).not.toHaveBeenCalled();
    for (const [, label] of VISIT_SOP_TEMPLATE.stage_a) fireEvent.change(screen.getByLabelText(label), { target: { value: 'done' } });
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน Stage A ครบและไป Stage B' })); expect(save.mock.calls[0][0]).toMatchObject({ command: 'complete_stage', stage: 'stage_a' });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: /Visit สำเร็จ/ })).not.toBeInTheDocument();
  });
  it('blocks Stage B until actual check-in, then uses existing SOP/interest revisions', () => {
    const snapshot = stageSnapshot('stage_b'), save = setup(snapshot); evidence(); submit(); expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'บันทึกเริ่มพาชมจริง' })).toBeDisabled(); cleanup();
    snapshot.anchor = { ...snapshot.anchor, visitId: sopId(4), visitStatus: 'awaiting_voice', checkedInAt: '2026-09-24T02:30:00Z' };
    const saved = setup(snapshot); evidence(); submit(); expect(saved).toHaveBeenCalledWith(expect.objectContaining({ command: 'start_tour', runId: sopId(7), expectedRunRevision: sopId(8), expectedInterestRevision: sopId(6) }));
  });
  it('Stage C has 13 independent answers and cannot complete without recap/departure and real next action', () => {
    const snapshot = stageSnapshot('stage_c'); snapshot.nextAction = null; const save = setup(snapshot); evidence();
    expect(screen.getByLabelText('เวลาลูกค้ากลับจริง (กรุงเทพฯ) *')).toHaveValue(''); expect(screen.getByLabelText('ความคิดเห็นลูกค้า *')).toHaveValue('');
    for (const [, label] of VISIT_SOP_TEMPLATE.stage_c) expect(screen.getByLabelText(label)).toHaveValue('pending');
    expect(screen.getByRole('button', { name: 'ยืนยัน Stage C ครบ (เฉพาะ SOP)' })).toBeDisabled(); submit(); expect(save.mock.calls[0][0].recap).toEqual({ feedback: '', objections: '', departedAt: null });
  });
  it('submits completed C as SOP evidence only, with real departure and no fake next-action command', () => {
    const save = setup(stageSnapshot('stage_c')); evidence();
    for (const [, label] of VISIT_SOP_TEMPLATE.stage_c) fireEvent.change(screen.getByLabelText(label), { target: { value: 'done' } });
    fireEvent.change(screen.getByLabelText('ความคิดเห็นลูกค้า *'), { target: { value: 'ชอบบ้าน' } });
    fireEvent.change(screen.getByLabelText('ข้อกังวลลูกค้า (ถ้าไม่มี ให้ระบุว่าไม่มี) *'), { target: { value: 'ไม่มี' } });
    fireEvent.change(screen.getByLabelText('เวลาลูกค้ากลับจริง (กรุงเทพฯ) *'), { target: { value: '2026-09-24T11:30:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน Stage C ครบ (เฉพาะ SOP)' }));
    expect(save.mock.calls[0][0]).toMatchObject({ command: 'complete_stage', stage: 'stage_c', recap: { feedback: 'ชอบบ้าน', objections: 'ไม่มี', departedAt: '2026-09-24T11:30:00+07:00' } });
    expect(save.mock.calls[0][0]).not.toHaveProperty('nextAction'); expect(save.mock.calls[0][0]).not.toHaveProperty('visitStatus');
  });
  it('resumes saved answers but leaves new operation time blank and preserves unchanged departure precision', () => {
    const snapshot = stageSnapshot('stage_c'); snapshot.run!.departedAt = '2026-09-24T04:00:00.123456+00:00'; snapshot.run!.recap = { feedback: 'ความเห็นเดิม', objections: 'ข้อกังวลเดิม' };
    snapshot.run!.items.find(item => item.stage === 'stage_c')!.result = 'done'; const save = setup(snapshot);
    expect(screen.getByLabelText(VISIT_SOP_TEMPLATE.stage_c[0][1])).toHaveValue('done'); expect(screen.getByLabelText('วันเวลาที่ทำรายการจริง (กรุงเทพฯ) *')).toHaveValue(''); evidence(); submit();
    expect(save.mock.calls[0][0].recap.departedAt).toBe(snapshot.run!.departedAt);
  });
  it.each(['admin', 'owner', 'other_sales', 'lost', 'completed'] as const)('never lets %s perform SOP or impersonate Sales', restriction => {
    const snapshot: VisitSopSnapshot = sopSnapshot();
    if (restriction === 'admin' || restriction === 'owner') snapshot.actor.role = restriction;
    else if (restriction === 'other_sales') snapshot.scope.ownerUserId = sopId(99);
    else if (restriction === 'lost') snapshot.scope.engagementStatus = 'lost'; else snapshot.run = sopRun('completed');
    setup(snapshot); expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });
});

import { parseVisitSopInput, VISIT_SOP_TEMPLATE, VISIT_SOP_TEMPLATE_VERSION, type VisitSopAnchor, type VisitSopInput, type VisitSopResult, type VisitSopRun, type VisitSopScope, type VisitSopSnapshot, type VisitSopStage } from '../visitSopContracts';
export const sopId = (n: number) => `bc250000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const sopAnchor = (): VisitSopAnchor => ({ customerId: sopId(1), interestId: sopId(2), appointmentId: sopId(3), visitId: null });
export const sopScope = (): VisitSopScope => ({ ...sopAnchor(), eventPage: 0 });
export const sopInput = (overrides: Record<string, unknown> = {}): VisitSopInput => {
  const command = overrides.command ?? 'start', stage = overrides.stage === 'stage_c' ? 'stage_c' : 'stage_a';
  return parseVisitSopInput({ ...sopAnchor(), requestId: sopId(9), expectedInterestRevision: sopId(6), command,
    occurredAt: '2026-09-24T05:00:00+00:00', reason: 'เตรียมบ้านตามนัด',
    ...(command === 'start' ? { plotId: 'SYNTHETIC-HOUSE' } : { runId: sopId(7), expectedRunRevision: sopId(8),
      ...(command === 'start_tour' ? {} : { stage, answers: VISIT_SOP_TEMPLATE[stage].map(([key]) => ({ key, result: command === 'complete_stage' ? 'done' : 'pending', reason: null })),
        recap: stage === 'stage_a' ? null : { feedback: 'ชอบบ้าน', objections: 'ไม่มีข้อกังวล', departedAt: '2026-09-24T04:00:00+00:00' } }) }),
    ...overrides });
};
export const sopResult = (input: VisitSopInput = sopInput()): VisitSopResult => ({
  requestId: input.requestId, command: input.command, customerId: input.customerId, interestId: input.interestId,
  runId: input.command === 'start' ? sopId(7) : input.runId, runRevision: sopId(11),
  stage: input.command === 'start' ? 'stage_a' : input.command === 'start_tour' ? 'stage_c' : input.command === 'save_stage' ? input.stage : input.stage === 'stage_a' ? 'stage_b' : 'completed',
  appointmentId: input.appointmentId, visitId: input.visitId ?? (input.command === 'start_tour' || 'stage' in input && input.stage === 'stage_c' ? sopId(4) : null), eventId: sopId(10), replayed: false,
});
export function sopRun(stage: VisitSopStage = 'stage_a'): VisitSopRun {
  return { id: sopId(7), revision: sopId(8), plotId: 'SYNTHETIC-HOUSE', responsibleSalesUserId: sopId(5), templateVersion: VISIT_SOP_TEMPLATE_VERSION, currentStage: stage,
    stageACompletedAt: stage === 'stage_a' ? null : '2026-09-24T02:00:00+00:00', stageBStartedAt: stage === 'stage_a' || stage === 'stage_b' ? null : '2026-09-24T03:00:00+00:00',
    stageCCompletedAt: stage === 'completed' ? '2026-09-24T04:30:00+00:00' : null, departedAt: stage === 'completed' ? '2026-09-24T04:00:00+00:00' : null,
    recap: { feedback: stage === 'completed' ? 'ชอบบ้าน' : '', objections: stage === 'completed' ? 'ไม่มีข้อกังวล' : '' },
    nextAction: stage === 'completed' ? 'ติดต่อสอบถามหลังชม' : null, nextFollowUpAt: stage === 'completed' ? '2026-09-25T03:00:00+00:00' : null,
    items: (['stage_a', 'stage_c'] as const).flatMap(s => VISIT_SOP_TEMPLATE[s].map(([key, label]) => {
      const answered = s === 'stage_a' ? stage !== 'stage_a' : stage === 'completed';
      return { stage: s, key, label, result: answered ? 'done' as const : 'pending' as const, reason: null, answeredByUserId: answered ? sopId(5) : null, answeredAt: answered ? '2026-09-24T02:00:00+00:00' : null };
    })), createdAt: '2026-09-24T01:00:00+00:00', updatedAt: '2026-09-24T04:30:00+00:00' };
}
export function sopSnapshot(): VisitSopSnapshot {
  return { actor: { userId: sopId(5), role: 'sales' }, scope: { ...sopAnchor(), customerName: 'ลูกค้าสมมติ SOP', projectName: 'โครงการสมมติ', ownerUserId: sopId(5), interestRevision: sopId(6), engagementStatus: 'new', canWrite: true },
    anchor: { appointmentStatus: 'scheduled', visitId: null, visitStatus: null, checkedInAt: null }, plots: [{ id: 'SYNTHETIC-HOUSE', name: 'บ้านตัวอย่าง A1' }], plotsHasMore: false,
    run: null, nextAction: { id: sopId(12), action: 'โทรติดตาม', dueAt: '2026-09-25T03:00:00+00:00' }, events: [], eventPage: 0, eventsHasMore: false };
}

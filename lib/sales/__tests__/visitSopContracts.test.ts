import { describe, expect, it } from 'vitest';
import { parseVisitSopInput, parseVisitSopPageQuery, parseVisitSopQuery, parseVisitSopResult, parseVisitSopSnapshot, VISIT_SOP_TEMPLATE } from '../visitSopContracts';
import { sopAnchor, sopId, sopInput, sopResult, sopRun, sopScope, sopSnapshot } from './visitSopFixtures';
const stageInput = (command = 'save_stage', stage = 'stage_a') => sopInput({ command, stage });
describe('versioned SOP inputs and projections', () => {
  it('preserves historical unknown while honoring scoped permission for a real appointment', () => {
    const value = sopSnapshot(); value.scope.engagementStatus = 'legacy_unclassified'; value.scope.canWrite = false;
    expect(parseVisitSopSnapshot(value, sopScope()).scope.engagementStatus).toBe('legacy_unclassified');
    value.scope.canWrite = true;
    expect(parseVisitSopSnapshot(value, sopScope())).toMatchObject({ scope: { engagementStatus: 'legacy_unclassified', canWrite: true }, run: null });
    value.actor.role = 'admin'; expect(() => parseVisitSopSnapshot(value, sopScope())).toThrow();
    value.actor.role = 'sales'; value.scope.ownerUserId = sopId(99); expect(() => parseVisitSopSnapshot(value, sopScope())).toThrow();
    expect(() => parseVisitSopInput({ ...sopInput(), engagementStatus: 'legacy_unclassified' })).toThrow();
  });
  it('has 16 preparation and 13 post-visit items; no survey-complete or bulk default', () => {
    expect(VISIT_SOP_TEMPLATE.stage_a).toHaveLength(16); expect(VISIT_SOP_TEMPLATE.stage_c).toHaveLength(13);
    expect(sopRun().items.every(i => i.result === 'pending' && i.answeredByUserId === null)).toBe(true);
  });
  it.each(['start', 'start_tour', 'save_stage', 'complete_stage'])('validates command %s with exact fields', command => {
    const input = sopInput({ command }); expect(parseVisitSopInput(input)).toEqual(input); expect(parseVisitSopResult(sopResult(input), input)).toEqual(sopResult(input));
  });
  it('preserves plot natural key and normalizes only human text', () => {
    expect(sopInput({ plotId: ' HOUSE A ', reason: ' บันทึกจริง ' })).toMatchObject({ plotId: ' HOUSE A ', reason: 'บันทึกจริง' });
  });
  it.each([{ appointmentId: null, visitId: null }, { appointmentId: sopId(3), visitId: sopId(4) }, { ownerUserId: sopId(5) }, { templateVersion: 'new' }, { command: 'complete_visit' }, { occurredAt: '2026-09-24T08:00' }, { occurredAt: '2026-02-30T08:00:00Z' }, { reason: '' }, { reason: '\n' }, { reason: '\ud800' }, { reason: 'a'.repeat(1001) }, { plotId: 'a'.repeat(256) }])('rejects incomplete, forged or malformed command %j', change => {
    expect(() => parseVisitSopInput({ ...sopInput(), ...change })).toThrow();
  });
  it.each(['stage_a', 'stage_c'])('enforces the complete template for %s even when saving a draft', stage => {
    const input = stageInput('save_stage', stage); if (!('answers' in input)) throw new Error('fixture');
    expect(() => parseVisitSopInput({ ...input, answers: input.answers.slice(1) })).toThrow();
    expect(() => parseVisitSopInput({ ...input, answers: input.answers.map((i, n) => n === 0 ? { ...i, key: 'injected' } : i) })).toThrow();
    expect(() => parseVisitSopInput({ ...input, answers: input.answers.map((i, n) => n === 0 ? input.answers[1] : i) })).toThrow();
    expect(() => parseVisitSopInput({ ...input, answers: input.answers.map(i => ({ ...i, label: 'forged label' })) })).toThrow();
    expect(parseVisitSopInput({ ...input, answers: [...input.answers].reverse() })).toEqual(input);
  });
  it.each(['not_applicable', 'skipped'])('requires a per-item reason for %s', result => {
    const input = stageInput(); if (!('answers' in input)) throw new Error('fixture');
    const rows = input.answers.map((r, n) => n ? r : { ...r, result });
    expect(() => parseVisitSopInput({ ...input, answers: rows })).toThrow();
    expect(parseVisitSopInput({ ...input, answers: rows.map((r, n) => n ? r : { ...r, reason: ' ไม่มีอุปกรณ์นี้ ' }) })).toMatchObject({ answers: [{ result, reason: 'ไม่มีอุปกรณ์นี้' }, ...rows.slice(1)] });
  });
  it('permits a partial draft but never completes pending items or empty recap', () => {
    const input = stageInput(); expect(() => parseVisitSopInput({ ...input, command: 'complete_stage' })).toThrow();
    const c = stageInput('complete_stage', 'stage_c'); expect(parseVisitSopInput(c)).toEqual(c);
    for (const field of ['feedback', 'objections', 'departedAt']) expect(() => parseVisitSopInput({ ...c, recap: { ...('recap' in c ? c.recap : {}), [field]: field === 'departedAt' ? null : '' } })).toThrow();
    expect(() => parseVisitSopInput({ ...c, recap: { feedback: 'ดี', objections: 'ไม่มี', departedAt: '2026-09-24T06:00:00Z' } })).toThrow();
  });
  it('requires typed anchor in route, refuses repeated and unauthorized query fields', () => {
    expect(parseVisitSopPageQuery({ customerId: sopId(1), interestId: sopId(2), appointmentId: sopId(3) })).toEqual(sopAnchor());
    const url = `https://local.invalid?customerId=${sopId(1)}&interestId=${sopId(2)}&appointmentId=${sopId(3)}`;
    expect(parseVisitSopQuery(url)).toEqual(sopScope());
    for (const suffix of ['&eventPage=-1', '&eventPage=100001', '&eventPage=01', '&actor=admin', '&appointmentId=bad', `&visitId=${sopId(4)}`]) expect(() => parseVisitSopQuery(url + suffix)).toThrow();
    expect(() => parseVisitSopPageQuery({ customerId: sopId(1), interestId: sopId(2), appointmentId: [sopId(3)] })).toThrow();
  });
  it.each(['customerId', 'interestId', 'requestId', 'appointmentId', 'stage', 'command'])('never accepts mismatched result %s', field => {
    expect(() => parseVisitSopResult({ ...sopResult(), [field]: sopId(99) }, sopInput())).toThrow();
  });
  it('validates new run revision, matching run and linked Visit when advancing', () => {
    const input = sopInput({ command: 'start_tour' }); if (input.command !== 'start_tour') throw new Error('fixture');
    expect(() => parseVisitSopResult({ ...sopResult(input), runRevision: input.expectedRunRevision }, input)).toThrow();
    expect(() => parseVisitSopResult({ ...sopResult(input), runId: sopId(99) }, input)).toThrow();
    expect(() => parseVisitSopResult({ ...sopResult(input), visitId: null }, input)).toThrow();
  });
  it('projects trusted context without leaking extra fields', () => {
    const snapshot = sopSnapshot(); expect(parseVisitSopSnapshot({ ...snapshot, secret: 'no', customerIncome: 2 }, sopScope())).toEqual(snapshot);
    snapshot.run = sopRun(); expect(parseVisitSopSnapshot(snapshot, sopScope())).toEqual(snapshot);
  });
  it.each(['admin', 'owner', 'other_sales', 'lost', 'cancelled', 'no_show', 'completed'])('rejects forged write permission for %s', type => {
    const snapshot = sopSnapshot();
    if (type === 'admin' || type === 'owner') snapshot.actor.role = type;
    else if (type === 'other_sales') snapshot.actor.userId = sopId(99);
    else if (type === 'lost') snapshot.scope.engagementStatus = 'lost';
    else if (type === 'completed') snapshot.run = sopRun('completed');
    else snapshot.anchor.appointmentStatus = type as 'cancelled' | 'no_show';
    expect(() => parseVisitSopSnapshot(snapshot, sopScope())).toThrow();
  });
  it.each(['customer', 'anchor', 'page', 'too_many_plots', 'duplicate_plot', 'missing_plot_page', 'too_many_events', 'missing_event_page'])('rejects misleading context %s', type => {
    const s = sopSnapshot();
    if (type === 'customer') s.scope.customerId = sopId(99);
    else if (type === 'anchor') s.scope.appointmentId = sopId(99);
    else if (type === 'page') s.eventPage = 1;
    else if (type === 'too_many_plots') s.plots = Array.from({ length: 201 }, (_, n) => ({ id: String(n), name: String(n) }));
    else if (type === 'duplicate_plot') s.plots.push(s.plots[0]);
    else if (type === 'missing_plot_page') s.plotsHasMore = true;
    else if (type === 'missing_event_page') s.eventsHasMore = true;
    else s.events = Array(51).fill({});
    expect(() => parseVisitSopSnapshot(s, sopScope())).toThrow();
  });
  it.each(['label', 'key', 'missing', 'duplicate', 'false_done', 'false_pending', 'reason', 'stage_time', 'template'])('rejects false checklist evidence %s', type => {
    const snapshot = sopSnapshot(), run = sopRun(); snapshot.run = run;
    if (type === 'label') run.items[0].label = 'forged';
    else if (type === 'key') run.items[0].key = 'forged';
    else if (type === 'missing') run.items.pop();
    else if (type === 'duplicate') run.items[0] = run.items[1];
    else if (type === 'false_done') run.items[0].result = 'done';
    else if (type === 'false_pending') { run.items[0].answeredAt = run.createdAt; run.items[0].answeredByUserId = sopId(5); }
    else if (type === 'reason') { run.items[0].result = 'skipped'; run.items[0].answeredAt = run.createdAt; run.items[0].answeredByUserId = sopId(5); }
    else if (type === 'template') run.templateVersion = 'unverified';
    else run.currentStage = 'stage_b';
    expect(() => parseVisitSopSnapshot(snapshot, sopScope())).toThrow();
  });
  it('retains completed SOP independently of pending Customer Voices', () => {
    const snapshot = sopSnapshot(); snapshot.run = sopRun('completed'); snapshot.scope.canWrite = false;
    snapshot.anchor = { appointmentStatus: 'attended', visitId: sopId(4), visitStatus: 'awaiting_voice', checkedInAt: '2026-09-24T02:30:00Z' };
    expect(parseVisitSopSnapshot(snapshot, sopScope()).anchor.visitStatus).toBe('awaiting_voice');
  });
  it('cannot display a later SOP stage without real check-in evidence', () => {
    const snapshot = sopSnapshot(); snapshot.run = sopRun('stage_c');
    expect(() => parseVisitSopSnapshot(snapshot, sopScope())).toThrow();
    snapshot.anchor = { appointmentStatus: 'attended', visitId: sopId(4), visitStatus: 'awaiting_voice', checkedInAt: '2026-09-24T04:00:00Z' };
    expect(() => parseVisitSopSnapshot(snapshot, sopScope())).toThrow();
  });
});

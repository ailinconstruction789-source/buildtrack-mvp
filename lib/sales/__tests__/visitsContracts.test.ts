// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { activeAppointment, parseVisitsInput, parseVisitsPageQuery, parseVisitsQuery, parseVisitsResult, parseVisitsSnapshot, type VisitsInput } from '../visitsContracts';
import { viId, viInput, viResult, viScope, viSnapshot } from './visitsFixtures';

const checkIn = (): VisitsInput => { const { startsAt: _s, endsAt: _e, ...base } = viInput(); void _s; void _e; return { ...base, command: 'check_in', appointmentId: null, expectedAppointmentRevision: null }; };
describe('central visits contracts', () => {
  it('keeps exact explicit event and planned times separately', () => { expect(parseVisitsInput(viInput())).toEqual(viInput()); });
  it.each([{ reason: '' }, { reason: 'a\nb' }, { reason: '\ud800' }, { reason: 'ก'.repeat(1001) }, { occurredAt: '2026-02-30T00:00:00Z' },
    { occurredAt: '2026-09-23T01:00:00' }, { startsAt: '2026-09-24' }, { endsAt: '2026-09-24T08:00:00+07:00' }, { startsAt: null }, { ownerUserId: viId(5) },
    { command: 'complete_visit' }, { expectedInterestRevision: '' }])('rejects malformed input %j', changes => { expect(() => parseVisitsInput({ ...viInput(), ...changes })).toThrow(); });
  it('permits reschedule and both terminal appointment commands without unrequested fields', () => {
    const { startsAt, endsAt, ...base } = viInput();
    for (const command of ['reschedule', 'cancel_appointment', 'no_show']) {
      const input = { ...base, command, appointmentId: viId(10), expectedAppointmentRevision: viId(11), ...(command === 'reschedule' ? { startsAt, endsAt } : {}) };
      expect(parseVisitsInput(input)).toEqual(input);
    }
  });
  it('walk-in does not invent an appointment', () => { expect(parseVisitsInput(checkIn())).toEqual(checkIn()); expect(parseVisitsResult(viResult(checkIn()), checkIn()).appointmentId).toBeNull(); });
  it.each([{ appointmentId: viId(10) }, { expectedAppointmentRevision: viId(11) }, { appointmentId: '' }, { actorUserId: viId(5) }])('rejects incomplete appointment binding %j', changes => {
    expect(() => parseVisitsInput({ ...checkIn(), ...changes })).toThrow();
  });
  it('cancels an existing visit with independent revision', () => {
    const { appointmentId: _a, expectedAppointmentRevision: _r, ...base } = checkIn() as Extract<VisitsInput, { command: 'check_in' }>; void _a; void _r;
    const input: VisitsInput = { ...base, command: 'cancel_visit', visitId: viId(12), expectedVisitRevision: viId(13) };
    expect(parseVisitsInput(input)).toEqual(input); expect(parseVisitsResult(viResult(input, { visitRevision: viId(19) }), input).visitId).toBe(viId(12));
    expect(() => parseVisitsResult(viResult(input), input)).toThrow();
  });
  it('scope is exact and bounded, including page links', () => {
    expect(parseVisitsQuery(`https://local.invalid/?customerId=${viId(1)}&interestId=${viId(2)}`)).toEqual(viScope);
    expect(parseVisitsPageQuery({ customerId: viId(1), interestId: viId(2) })).toEqual({ customerId: viId(1), interestId: viId(2) });
    for (const suffix of ['&visitPage=01', '&eventPage=100001', '&appointmentPage=-1', '&visitPage=0&visitPage=1', '&actor=admin']) {
      expect(() => parseVisitsQuery(`https://local.invalid/?customerId=${viId(1)}&interestId=${viId(2)}${suffix}`)).toThrow();
    }
    expect(() => parseVisitsPageQuery({ customerId: viId(1), interestId: [viId(2)] })).toThrow();
  });
  it.each(['requestId', 'customerId', 'interestId', 'command'])('rejects result identity mismatch %s', field => {
    expect(() => parseVisitsResult({ ...viResult(), [field]: field === 'command' ? 'check_in' : viId(30) }, viInput())).toThrow();
  });
  it('rejects mismatched result links and preserves new revision', () => {
    expect(() => parseVisitsResult({ ...viResult(), appointmentRevision: null }, viInput())).toThrow();
    expect(() => parseVisitsResult({ ...viResult(), visitId: viId(12), visitRevision: viId(13) }, viInput())).toThrow();
    expect(() => parseVisitsResult({ ...viResult(checkIn()), appointmentId: viId(10), appointmentRevision: viId(11) }, checkIn())).toThrow();
  });
  it('parses bounded scoped snapshot, projects fields explicitly', () => { expect(parseVisitsSnapshot({ ...viSnapshot(), token: 'not projected' }, viScope)).toEqual(viSnapshot()); });
  it.each(['owner', 'other_sales', 'lost'])('does not trust impossible editable scope: %s', kind => {
    const value = viSnapshot(); if (kind === 'owner') value.actor.role = 'owner'; else if (kind === 'other_sales') value.actor.userId = viId(25); else value.scope.engagementStatus = 'lost';
    expect(() => parseVisitsSnapshot(value, viScope)).toThrow(); value.scope.canEdit = false; expect(parseVisitsSnapshot(value, viScope).scope.canEdit).toBe(false);
  });
  it('completed visit needs same-record completion evidence fields, never a default', () => {
    const value = viSnapshot(); value.visits = [{ id: viId(12), revision: viId(13), appointmentId: viId(10), status: 'completed', checkedInAt: '2026-09-23T01:00:00Z',
      checkedInByUserId: viId(5), completedAt: null, completedVoiceId: null }];
    expect(() => parseVisitsSnapshot(value, viScope)).toThrow(); value.visits[0].completedAt = '2026-09-23T02:00:00Z'; value.visits[0].completedVoiceId = viId(50);
    expect(parseVisitsSnapshot(value, viScope).visits).toEqual(value.visits);
    value.visits[0].status = 'awaiting_voice'; expect(() => parseVisitsSnapshot(value, viScope)).toThrow();
  });
  it('rejects wrong scope, duplicate rows and unbounded histories', () => {
    const value = viSnapshot(); expect(() => parseVisitsSnapshot(value, { ...viScope, interestId: viId(99) })).toThrow();
    value.appointments.push(value.appointments[0]); expect(() => parseVisitsSnapshot(value, viScope)).toThrow();
    value.appointments = []; value.appointmentsHasMore = true; expect(() => parseVisitsSnapshot(value, viScope)).toThrow();
  });
  it('projects only history scheduling fields, never customer data/token', () => {
    const value = viSnapshot(); value.events = [{ id: viId(14), command: 'schedule', appointmentId: viId(10), visitId: null, occurredAt: '2026-09-23T01:00:00Z',
      recordedAt: '2026-09-23T01:00:01Z', actorUserId: viId(5), reason: 'นัดหมาย', details: { startsAt: '2026-09-24T01:00:00Z', endsAt: null, status: 'scheduled' } }];
    expect(parseVisitsSnapshot(value, viScope).events).toEqual(value.events);
    value.events[0].details.token = 'bad'; expect(() => parseVisitsSnapshot(value, viScope)).toThrow();
  });
  it('rescheduled appointments remain actionable, terminal appointments do not', () => {
    expect(activeAppointment('scheduled')).toBe(true); expect(activeAppointment('rescheduled')).toBe(true);
    for (const status of ['attended', 'cancelled', 'no_show'] as const) expect(activeAppointment(status)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { CustomerVoicesInputError, parseVoiceAnswers, parseVoicePublicInput, parseVoicePublicResult, parseVoiceQuery, parseVoiceScope,
  parseVoiceSnapshot, parseVoiceStaffInput, parseVoiceStaffResult, parseVoiceToken, VOICE_SCORES } from '../customerVoicesContracts';
import { voiceAnswers, voiceId, voiceInput, voiceResult, voiceScope, voiceSnapshot, voiceSubmission, voiceToken } from './customerVoicesFixtures';
describe('Customer Voices strict privacy and submission contracts', () => {
  it('requires exactly eight chosen scores without inventing any optional answers', () => {
    expect(parseVoiceAnswers(voiceAnswers())).toEqual(voiceAnswers()); expect(Object.keys(parseVoiceAnswers(voiceAnswers()))).toHaveLength(8);
    expect(() => parseVoiceAnswers({})).toThrow(CustomerVoicesInputError);
  });
  it.each(VOICE_SCORES)('requires explicit score %s', key => {
    const answers = { ...voiceAnswers() } as Record<string, unknown>; delete answers[key]; expect(() => parseVoiceAnswers(answers)).toThrow();
    for (const value of [null, '', '5', true, 0, 6, 1.1, NaN, Infinity, [], {}]) expect(() => parseVoiceAnswers({ ...voiceAnswers(), [key]: value })).toThrow();
    for (const value of [1, 2, 3, 4, 5]) expect(parseVoiceAnswers({ ...voiceAnswers(), [key]: value })[key]).toBe(value);
  });
  it('retains explicit optional values including zero/false but not blank/defaults', () => {
    expect(parseVoiceAnswers({ ...voiceAnswers(), nickname: ' แอน ', monthly_rent: 0, purpose_relocate: false })).toEqual({ ...voiceAnswers(), nickname: 'แอน', purpose_relocate: false, monthly_rent: 0 });
    for (const change of [{ nickname: '' }, { monthly_income: null }, { purpose_relocate: 'true' }, { monthly_rent: -1 }, { monthly_rent: 0.001 }, { monthly_rent: 10000000 }]) expect(() => parseVoiceAnswers({ ...voiceAnswers(), ...change })).toThrow();
  });
  it.each(['customer_name', 'phone', 'lead_id', 'visit_id', 'score_average', 'crm_validated_at', 'crm_submitted_by_customer', 'education_level', 'unknown'])('refuses server-owned/injected field %s', key => {
    expect(() => parseVoiceAnswers({ ...voiceAnswers(), [key]: 'forged' })).toThrow();
  });
  it.each(['\n', '\u0000', '\u007f', '\u0085', '\u2028', '\ud800'])('rejects controls and broken unicode %j', character => {
    expect(() => parseVoiceAnswers({ ...voiceAnswers(), nickname: `a${character}b` })).toThrow();
  });
  it('bounds unicode by codepoints and preserves actual text', () => {
    expect(parseVoiceAnswers({ ...voiceAnswers(), nickname: '😀'.repeat(500) }).nickname).toHaveLength(1000);
    expect(() => parseVoiceAnswers({ ...voiceAnswers(), nickname: '😀'.repeat(501) })).toThrow();
  });
  it('only accepts 256-bit lowercase hex secrets with no whitespace', () => {
    expect(parseVoiceToken(voiceToken)).toBe(voiceToken);
    for (const value of [voiceToken.toUpperCase(), voiceToken.slice(1), voiceToken + 'a', 'z'.repeat(64), ` ${voiceToken}`, null]) expect(() => parseVoiceToken(value)).toThrow();
  });
  it('strictly scopes staff operations without implicit/customer selection', () => {
    expect(parseVoiceScope(voiceScope())).toEqual(voiceScope()); expect(parseVoiceQuery(`https://local.invalid/?${new URLSearchParams(voiceScope() as unknown as Record<string, string>)}`)).toEqual(voiceScope());
    for (const suffix of ['&visitId=bad', '&token=secret', '&page=0']) expect(() => parseVoiceQuery(`https://local.invalid/?${new URLSearchParams(voiceScope() as unknown as Record<string, string>)}${suffix}`)).toThrow();
    expect(() => parseVoiceScope({ ...voiceScope(), customerId: [voiceId(1)] })).toThrow();
  });
  it('distinguishes issue/rotation from revoke and preserves optimistic references', () => {
    expect(parseVoiceStaffInput(voiceInput())).toEqual(voiceInput());
    const revoke = { ...voiceInput(), command: 'revoke', token: null, expectedTokenId: voiceId(40) }; expect(parseVoiceStaffInput(revoke)).toEqual(revoke);
    for (const change of [{ reason: '' }, { command: 'revoke' }, { token: null }, { expectedTokenId: '' }, { actorId: voiceId(5) }, { expiresAt: '2099-01-01' }]) expect(() => parseVoiceStaffInput({ ...voiceInput(), ...change })).toThrow();
  });
  it('matches receipt scope/command/request and does not accept embedded secrets', () => {
    expect(parseVoiceStaffResult(voiceResult(), voiceInput())).toEqual(voiceResult());
    for (const change of [{ requestId: voiceId(99) }, { visitId: voiceId(99) }, { command: 'revoke' }, { token: voiceToken }]) expect(() => parseVoiceStaffResult({ ...voiceResult(), ...change }, voiceInput())).toThrow();
  });
  it('permits only versioned exact payloads and generic public results', () => {
    expect(parseVoicePublicInput(voiceSubmission())).toEqual(voiceSubmission());
    for (const change of [{ formVersion: 'future' }, { visitId: voiceId(3) }, { submittedAt: 'now' }, { requestId: null }]) expect(() => parseVoicePublicInput({ ...voiceSubmission(), ...change })).toThrow();
    expect(parseVoicePublicResult({ submitted: true, replayed: true }, voiceSubmission())).toEqual({ submitted: true, replayed: true });
    for (const change of [{ answers: voiceAnswers() }, { customerName: 'private' }, { visitId: voiceId(3) }]) expect(() => parseVoicePublicResult({ submitted: true, replayed: false, ...change }, voiceSubmission())).toThrow();
    expect(() => parseVoicePublicResult({ formVersion: 'customer_voices_v1', expiresAt: '2026-09-25T10:00:00Z', phone: 'private' }, { command: 'open', token: voiceToken })).toThrow();
  });
  it('does not trust canManage for foreign Sales or Owner and does not expose other Sales answers', () => {
    const snapshot = voiceSnapshot(); expect(parseVoiceSnapshot(snapshot, voiceScope())).toEqual(snapshot);
    snapshot.actor.role = 'owner'; expect(() => parseVoiceSnapshot(snapshot, voiceScope())).toThrow(); snapshot.scope.canManage = false; expect(parseVoiceSnapshot(snapshot, voiceScope()).scope.canManage).toBe(false);
    snapshot.actor.role = 'sales'; snapshot.actor.userId = voiceId(99); snapshot.visit.status = 'completed'; snapshot.visit.completedAt = '2026-09-24T11:00:00Z';
    snapshot.submission = { submittedAt: snapshot.visit.completedAt, answers: voiceAnswers() }; expect(() => parseVoiceSnapshot(snapshot, voiceScope())).toThrow();
    snapshot.submission.answers = null; expect(parseVoiceSnapshot(snapshot, voiceScope()).submission?.answers).toBeNull();
  });
  it('requires completed evidence and no active token for completed/cancelled visits', () => {
    const snapshot = voiceSnapshot(); snapshot.visit.status = 'completed'; expect(() => parseVoiceSnapshot(snapshot, voiceScope())).toThrow();
    snapshot.visit.status = 'cancelled'; snapshot.scope.canManage = false; snapshot.activeToken = { id: voiceId(40), expiresAt: '2026-09-25T10:00:00Z' }; expect(() => parseVoiceSnapshot(snapshot, voiceScope())).toThrow();
  });
});

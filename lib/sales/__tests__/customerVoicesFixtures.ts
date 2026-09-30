import { parseVoiceAnswers, VOICE_SCORES, type VoiceAnswers, type VoicePublicInput, type VoiceScope, type VoiceSnapshot, type VoiceStaffInput, type VoiceStaffResult } from '../customerVoicesContracts';
export const voiceId = (n: number) => `ab000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const voiceToken = 'abc123ef'.repeat(8);
export const voiceScope = (): VoiceScope => ({ customerId: voiceId(1), interestId: voiceId(2), visitId: voiceId(3) });
export const voiceAnswers = (): VoiceAnswers => parseVoiceAnswers(Object.fromEntries(VOICE_SCORES.map(([k]) => [k, 4])));
export const voiceInput = (): VoiceStaffInput => ({ ...voiceScope(), requestId: voiceId(10), command: 'issue', expectedInterestRevision: voiceId(20),
  expectedVisitRevision: voiceId(30), expectedTokenId: null, token: voiceToken, reason: 'ลูกค้าขอทำแบบประเมินหลังเข้าชม' });
export const voiceResult = (input = voiceInput()): VoiceStaffResult => ({ requestId: input.requestId, command: input.command, visitId: input.visitId,
  tokenId: input.command === 'revoke' ? input.expectedTokenId! : voiceId(40), expiresAt: '2026-09-25T10:00:00Z', replayed: false });
export const voiceSubmission = (): VoicePublicInput & { command: 'submit' } => ({ command: 'submit', token: voiceToken, requestId: voiceId(50), formVersion: 'customer_voices_v1', answers: voiceAnswers() });
export const voiceSnapshot = (): VoiceSnapshot => ({ actor: { userId: voiceId(5), role: 'sales' },
  scope: { ...voiceScope(), customerName: 'ลูกค้าสังเคราะห์', projectName: 'โครงการทดสอบ', ownerUserId: voiceId(5), interestRevision: voiceId(20), canManage: true },
  visit: { revision: voiceId(30), status: 'awaiting_voice', checkedInAt: '2026-09-24T10:00:00Z', completedAt: null }, activeToken: null, submission: null, ttlHours: 24 });

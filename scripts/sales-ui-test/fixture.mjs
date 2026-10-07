/** Synthetic HTTP substitute, NOT PostgreSQL, PostgREST or an authorization certification. */
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

export const appOrigin = 'http://127.0.0.1:3146';
export const fixtureOrigin = 'http://127.0.0.1:3147';
export const fixtureKey = 'sb_publishable_synthetic_voices_only';
export const id = n => `ac000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const scope = { customerId: id(1), interestId: id(2), visitId: id(3) };
export const scopeQuery = new URLSearchParams(scope).toString();
const actors = { sales: { id: id(5), role: 'sales' }, otherSales: { id: id(6), role: 'sales' }, owner: { id: id(7), role: 'owner' }, admin: { id: id(8), role: 'admin' } };
export function sessionFor(kind = 'sales') {
  const actor = actors[kind];
  if (!actor) throw new Error('Unknown synthetic actor');
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: actor.id, role: 'authenticated', exp: expires })}.synthetic-signature`;
  return { access_token: token, refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, expires_at: expires,
    user: { id: actor.id, aud: 'authenticated', role: 'authenticated', email: 'fixture@example.invalid', app_metadata: {}, user_metadata: {} } };
}
const hash = value => createHash('sha256').update(value).digest('hex');
function actorFrom(request) {
  try {
    const token = request.headers.authorization?.replace(/^Bearer /, '');
    if (!token?.endsWith('.synthetic-signature')) return null;
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return Object.values(actors).find(a => a.id === claims.sub) ?? null;
  } catch { return null; }
}
export function createVoiceFixture() {
  let state;
  const reset = () => { state = { visitStatus: 'awaiting_voice', checkedInAt: new Date(Date.now() - 60_000).toISOString(),
    visitRevision: id(30), active: null, submission: null, submissions: 0, requests: [], receipts: new Map() }; };
  reset();
  const server = createServer(async (request, response) => {
    const send = (value, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': appOrigin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }); response.end(JSON.stringify(value)); };
    const reject = (marker, status = 400) => send({ code: 'P0001', message: `CRM_VOICE_${marker}` }, status);
    try {
      if (request.headers.host !== '127.0.0.1:3147') return send({ error: 'loopback only' }, 403);
      const url = new URL(request.url, fixtureOrigin);
      if (request.method === 'OPTIONS') return send({});
      let size = 0; const chunks = [];
      for await (const chunk of request) { size += chunk.length; if (size > 32768) return send({ error: 'too large' }, 413); chunks.push(chunk); }
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      // Control routes only exist in this test script, never in app/ or production.
      if (url.pathname.startsWith('/__fixture/')) {
        if (request.headers['x-voice-fixture'] !== 'synthetic-only') return send({}, 403);
        if (url.pathname === '/__fixture/reset' && request.method === 'POST') { reset(); return send({ syntheticOnly: true }); }
        if (url.pathname === '/__fixture/expire' && request.method === 'POST') { if (state.active) state.active.expiresAt = new Date(Date.now() - 1000).toISOString(); return send({}); }
        if (url.pathname === '/__fixture/state' && request.method === 'GET') return send({ ...state, receipts: undefined, syntheticOnly: true });
        return send({}, 404);
      }
      const actor = actorFrom(request);
      if (url.pathname === '/auth/v1/user') return actor ? send(sessionFor(Object.keys(actors).find(k => actors[k] === actor)).user) : send({ message: 'synthetic auth only' }, 401);
      if (!url.pathname.startsWith('/rest/v1/rpc/')) return send({}, 404);
      const rpc = url.pathname.slice('/rest/v1/rpc/'.length);
      state.requests.push({ rpc, body, actor: actor?.id ?? null });
      if (rpc === 'crm_v2_role') return send(actor?.role ?? null);
      if (rpc === 'crm_v2_customer_voices_capabilities') return send({ contract_version: 'customer_voices_v1', enabled: true });
      const canManage = actor && (actor.role === 'admin' || actor.id === id(5)) && state.visitStatus === 'awaiting_voice';
      if (rpc === 'crm_v2_customer_voices_context') {
        if (!actor) return reject('FORBIDDEN', 403);
        return send({ actor: { userId: actor.id, role: actor.role }, scope: { ...scope, customerName: 'ลูกค้าสมมติสำหรับทดสอบ', projectName: 'โครงการสมมติ',
          ownerUserId: id(5), interestRevision: id(20), canManage: !!canManage },
          visit: { revision: state.visitRevision, status: state.visitStatus, checkedInAt: state.checkedInAt, completedAt: state.submission?.submittedAt ?? null },
          activeToken: state.active && { id: state.active.id, expiresAt: state.active.expiresAt },
          submission: state.submission && { ...state.submission, answers: actor.role !== 'sales' || actor.id === id(5) ? state.submission.answers : null }, ttlHours: 24 });
      }
      if (rpc === 'crm_v2_customer_voices_command') {
        if (!canManage) return reject('FORBIDDEN', 403);
        const p = body.p_payload;
        if (p.expectedTokenId !== (state.active?.id ?? null)) return reject('STALE_STATE', 409);
        const active = p.command === 'issue' ? { id: randomUUID(), tokenHash: p.tokenHash, expiresAt: new Date(Date.now() + 86_400_000).toISOString() } : state.active;
        if (!active) return reject('STALE_STATE', 409);
        state.active = p.command === 'issue' ? active : null;
        return send({ requestId: body.p_request_id, command: p.command, visitId: scope.visitId, tokenId: active.id, expiresAt: active.expiresAt, replayed: false });
      }
      if (!['crm_v2_customer_voice_open', 'crm_v2_customer_voice_submit'].includes(rpc)) return send({}, 404);
      if (typeof body.p_token !== 'string') return reject('TOKEN_UNAVAILABLE', 410);
      const fingerprint = hash(body.p_token);
      const prior = state.receipts.get(body.p_request_id);
      if (rpc.endsWith('_submit') && prior && prior.fingerprint === fingerprint && prior.answers === JSON.stringify(body.p_answers)) return send({ submitted: true, replayed: true });
      if (!state.active || fingerprint !== state.active.tokenHash || Date.parse(state.active.expiresAt) <= Date.now() || state.visitStatus !== 'awaiting_voice') return reject('TOKEN_UNAVAILABLE', 410);
      if (rpc.endsWith('_open')) return send({ formVersion: 'customer_voices_v1', expiresAt: state.active.expiresAt });
      state.receipts.set(body.p_request_id, { fingerprint, answers: JSON.stringify(body.p_answers) });
      state.submission = { submittedAt: new Date().toISOString(), answers: body.p_answers };
      state.submissions++; state.visitStatus = 'completed'; state.visitRevision = randomUUID(); state.active = null;
      return send({ submitted: true, replayed: false });
    } catch { send({ error: 'synthetic fixture failure' }, 500); }
  });
  return server;
}

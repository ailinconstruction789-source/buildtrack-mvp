// @vitest-environment node
/** Cross-route release boundary. All clients are mocked: never connects to a database. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ createClient: vi.fn(), getUser: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mock.createClient }));
vi.mock('@/components/sales/NotificationsView', () => ({ default: () => null }));
vi.mock('@/components/sales/WorkScheduleView', () => ({ default: () => null }));
vi.mock('@/components/sales/SlaPreviewView', () => ({ default: () => null }));
vi.mock('@/components/sales/SlaProcessingView', () => ({ default: () => null }));
vi.mock('@/components/sales/QueueMonitorView', () => ({ default: () => null }));
import NotificationsPage from '@/app/sales-crm/notifications/page';
import WorkSchedulePage from '@/app/sales-crm/work-schedule/page';
import SlaPreviewPage from '@/app/sales-crm/sla-preview/page';
import SlaProcessingPage from '@/app/sales-crm/sla-processing/page';
import QueueMonitorPage from '@/app/sales-crm/queue-monitor/page';
import * as notifications from '@/app/api/sales-crm/notifications/route';
import * as schedule from '@/app/api/sales-crm/work-schedule/route';
import * as preview from '@/app/api/sales-crm/sla-preview/route';
import * as cycles from '@/app/api/sales-crm/sla-cycles/route';
import * as receipts from '@/app/api/sales-crm/sla-receipts/route';
import * as processing from '@/app/api/sales-crm/sla-process/route';
import * as queue from '@/app/api/sales-crm/queue-monitor/route';
import * as interests from '@/app/api/sales-crm/interests/route';
import * as work from '@/app/api/sales-crm/lead-work/route';
import * as lifecycle from '@/app/api/sales-crm/lifecycle/route';
import * as postBooking from '@/app/api/sales-crm/post-booking/route';
import * as reports from '@/app/api/sales-crm/reports/route';
import * as visits from '@/app/api/sales-crm/visits/route';
import * as sop from '@/app/api/sales-crm/sop/route';
import * as voices from '@/app/api/sales-crm/customer-voices/route';
import * as publicVoices from '@/app/api/customer-voices/route';
import * as followUp from '@/app/api/sales-crm/visit-follow-up/route';
import * as bookings from '@/app/api/sales-crm/bookings/route';
import * as bookingSearch from '@/app/api/sales-crm/bookings/search/route';
import * as central from '@/app/api/sales-crm/central/route';
import * as project from '@/app/api/sales-crm/project-sales/route';
import * as map from '@/app/api/sales-crm/project-map/route';
import { viId, viInput } from './visitsFixtures';
import { sopInput } from './visitSopFixtures';
import { voiceInput } from './customerVoicesFixtures';
import { bookingInput } from './bookingFixtures';

type Handler = (request: Request) => Promise<Response>;
type Routes = { GET?: Handler; POST?: Handler };
const allFlags = ['V2', 'LEAD_WORK', 'LIFECYCLE', 'BOOKING', 'PROJECT_SALES', 'PROJECT_WORKSPACE',
  'VISITS', 'VISIT_SOP', 'CUSTOMER_VOICES', 'VISIT_FOLLOW_UP', 'PROJECT_INTERESTS', 'POST_BOOKING',
  'SCHEDULE', 'NOTIFICATIONS', 'SLA_PREVIEW', 'SLA_PROCESSING', 'SLA_CYCLE', 'QUEUE_MONITOR'];
const deferred: [string, Routes][] = [
  ['notifications', notifications], ['work-schedule', schedule], ['sla-preview', preview],
  ['sla-cycles', cycles], ['sla-receipts', receipts], ['sla-process', processing],
  ['queue-monitor', queue], ['interests', interests], ['lead-work', work],
  ['lifecycle', lifecycle], ['post-booking', postBooking], ['reports', reports],
];
const added: [string, Routes][] = [['visits', visits], ['sop', sop], ['customer-voices', voices],
  ['public-customer-voices', publicVoices], ['visit-follow-up', followUp]];
function methods(entries: [string, Routes][]) {
  return entries.flatMap(([path, route]) => (['GET', 'POST'] as const)
    .flatMap(method => route[method] ? [{ path, method, handler: route[method]! }] : []));
}
function request(path: string, method = 'GET', query = '', body: unknown = {}) {
  return new Request(`https://synthetic.invalid/api/sales-crm/${path}${query}`, {
    method, headers: { Authorization: 'Bearer synthetic-caller', 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
}
const scoped = `?customerId=${viId(1)}&interestId=${viId(2)}`;
const nextAction = { requestId: viId(6), command: 'set_next_action', customerId: viId(1), interestId: viId(2),
  expectedActionId: null, nextAction: { action: 'ติดตามหลังชม', dueAt: '2026-10-15T12:00:00Z' }, reason: 'ลูกค้านัดติดตาม' };
const protectedRoutes: { name: string; handler: Handler; req: () => Request; allowed: string[] }[] = [
  { name: 'visits GET', handler: visits.GET, req: () => request('visits', 'GET', scoped), allowed: ['sales', 'admin', 'owner'] },
  { name: 'visits POST', handler: visits.POST, req: () => request('visits', 'POST', '', viInput()), allowed: ['sales', 'admin'] },
  { name: 'sop GET', handler: sop.GET, req: () => request('sop', 'GET', `${scoped}&appointmentId=${viId(3)}`), allowed: ['sales', 'admin', 'owner'] },
  { name: 'sop POST', handler: sop.POST, req: () => request('sop', 'POST', '', sopInput()), allowed: ['sales'] },
  { name: 'voices GET', handler: voices.GET, req: () => request('voices', 'GET', `${scoped}&visitId=${viId(3)}`), allowed: ['sales', 'admin', 'owner'] },
  { name: 'voices POST', handler: voices.POST, req: () => request('voices', 'POST', '', voiceInput()), allowed: ['sales', 'admin'] },
  { name: 'follow-up GET', handler: followUp.GET, req: () => request('visit-follow-up', 'GET', scoped), allowed: ['sales', 'admin', 'owner'] },
  { name: 'follow-up POST', handler: followUp.POST, req: () => request('visit-follow-up', 'POST', '', nextAction), allowed: ['sales'] },
  { name: 'central GET (baseline)', handler: central.GET, req: () => request('central'), allowed: ['sales', 'admin', 'owner'] },
  { name: 'central POST (baseline)', handler: central.POST, req: () => request('central', 'POST', '', { requestId: viId(6), name: 'Synthetic', phone: '0812345678', channel: 'โทร', notes: '', interests: [] }), allowed: ['sales', 'admin'] },
  { name: 'bookings GET (baseline)', handler: bookings.GET, req: () => request('bookings', 'GET', `?customerId=${viId(1)}`), allowed: ['sales', 'admin', 'owner'] },
  { name: 'bookings POST (baseline)', handler: bookings.POST, req: () => request('bookings', 'POST', '', bookingInput()), allowed: ['sales', 'admin'] },
  { name: 'booking search GET (baseline)', handler: bookingSearch.GET, req: () => request('bookings/search', 'GET', '?q=Synthetic'), allowed: ['sales', 'admin', 'owner'] },
  { name: 'project-sales GET (baseline)', handler: project.GET, req: () => request('project-sales', 'GET', '?projectName=Synthetic'), allowed: ['sales', 'admin', 'owner'] },
  { name: 'project-map GET (baseline)', handler: map.GET, req: () => request('project-map', 'GET', '?projectName=Synthetic'), allowed: ['sales', 'admin', 'owner'] },
];

beforeEach(() => {
  vi.resetAllMocks();
  allFlags.forEach(flag => vi.stubEnv(`SALES_CRM_${flag}_ENABLED`, 'true'));
  vi.stubEnv('SALES_CRM_RELEASE_SCOPE', 'central_visits');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.invalid');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-synthetic-key');
  mock.createClient.mockReturnValue({ auth: { getUser: mock.getUser }, rpc: mock.rpc, from: mock.from });
  mock.getUser.mockResolvedValue({ data: { user: { id: viId(5), user_metadata: { role: 'admin' } } }, error: null });
});
afterEach(() => { expect(mock.from).not.toHaveBeenCalled(); vi.unstubAllEnvs(); });

describe.each(['central_booking', 'central_visits', 'misspelled_scope'])('bounded scope %s with every optional flag stale-on', scope => {
  it.each(methods(deferred))('seals $path $method before parsing, identity or network', async ({ path, method, handler }) => {
    vi.stubEnv('SALES_CRM_RELEASE_SCOPE', scope);
    const response = await handler(request(path, method));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'FEATURE_DISABLED' } });
    expect(mock.createClient).not.toHaveBeenCalled(); expect(mock.rpc).not.toHaveBeenCalled();
  });
});
describe.each(['central_booking', 'misspelled_scope'])('visit additions stay closed under %s', scope => {
  it.each(methods(added))('seals $path $method without touching the existing booking release', async ({ path, method, handler }) => {
    vi.stubEnv('SALES_CRM_RELEASE_SCOPE', scope);
    const response = await handler(request(path, method));
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ error: { code: 'FEATURE_DISABLED' } });
    expect(mock.createClient).not.toHaveBeenCalled();
  });
});
describe.each(['sales', 'admin', 'owner', 'foreman', 'contractor', 'accounting'])('central_visits verified role %s', role => {
  it.each(protectedRoutes)('$name enforces its own role before any data/capability result', async ({ handler, req, allowed }) => {
    // Stop allowed callers at a deliberately unavailable capability; no synthetic records need to be trusted.
    mock.rpc.mockImplementation(async (name: string) => name === 'crm_v2_role'
      ? { data: role, error: null } : { data: null, error: { code: '42883', message: 'uninstalled capability' } });
    const response = await handler(req());
    expect(response.status).toBe(allowed.includes(role) ? 503 : 403);
    expect(await response.json()).toMatchObject({ error: { code: allowed.includes(role) ? 'SETUP_REQUIRED' : 'FORBIDDEN' } });
    expect(mock.getUser).toHaveBeenCalledWith('synthetic-caller');
    expect(mock.rpc.mock.calls[0][0]).toBe('crm_v2_role');
    expect(mock.rpc).toHaveBeenCalledTimes(allowed.includes(role) ? 2 : 1);
  });
});
describe.each(['missing bearer', 'expired session'])('central_visits identity denial: %s', condition => {
  it.each(protectedRoutes)('$name never reaches role or data RPC without verified identity', async ({ handler, req }) => {
    const input = req();
    if (condition === 'missing bearer') input.headers.delete('Authorization');
    else mock.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } });
    const response = await handler(input);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    expect(mock.rpc).not.toHaveBeenCalled();
    if (condition === 'missing bearer') expect(mock.createClient).not.toHaveBeenCalled();
  });
});
const deferredPages = [NotificationsPage, WorkSchedulePage, SlaPreviewPage, SlaProcessingPage, QueueMonitorPage];
describe.each(['central_booking', 'central_visits', 'misspelled_scope'])('direct page entry under %s', scope => {
  it.each(deferredPages)('%s returns the closed page without rendering its client workspace', page => {
    vi.stubEnv('SALES_CRM_RELEASE_SCOPE', scope);
    expect(page().type).toBe('main'); expect(mock.createClient).not.toHaveBeenCalled();
  });
});
it.each(deferredPages)('preserves unscoped feature-flag behavior for %s', page => {
  vi.stubEnv('SALES_CRM_RELEASE_SCOPE', undefined);
  expect(page().type).not.toBe('main'); expect(mock.createClient).not.toHaveBeenCalled();
});

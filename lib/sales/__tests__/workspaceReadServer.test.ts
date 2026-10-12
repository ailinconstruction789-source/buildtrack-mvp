// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), from: vi.fn(), createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mock.createClient }));
import { handleProjectSalesGet } from '../projectSalesServer';
import { handleCentralGet } from '../centralServer';
import { EMPTY_CENTRAL_SEARCH } from '../centralContracts';
import { WORKSPACE_READ_CONTRACT_VERSION } from '../workspaceReadContracts';
import { projectSale, projectSnapshot, pid } from './projectSalesFixtures';
const membership = { active: true, revisionId: pid(90), originalLegacyLeadIds: [pid(91)] };
const scope = '?projectName=โครงการ A';
const request = (query = scope, auth = true) => new Request(`https://test.invalid/${query}`, { headers: auth ? { authorization: 'Bearer user-test-token' } : {} });
const project = () => ({ ...projectSnapshot(), sourceMembership: membership, rows: [projectSale({ sourceKind: 'reviewed_import', visitHistoryDate: null, bankName: 'A', expectedTransferDate: '2026-12-01', leadId: null })] });
const central = () => ({ actor: { userId: pid(8), role: 'sales' }, projects: [], salesOwners: [], customers: [], page: 0, hasMore: false, sourceMembership: membership,
  search: { contractVersion: 'central_search_v1', filters: EMPTY_CENTRAL_SEARCH, projects: [], owners: [], channels: [], hasMoreChannels: false } });
function configure(overrides: Record<string, { data?: unknown; error?: unknown }> = {}) {
  mock.rpc.mockImplementation(async name => overrides[name] ?? { error: null, data: name === 'crm_v2_role' ? 'sales'
    : name === 'crm_v2_capabilities' ? { contract_version: 'central_intake_v1', enabled: true }
      : name === 'crm_v2_workspace_capabilities' ? { contract_version: WORKSPACE_READ_CONTRACT_VERSION, enabled: true, sourceMembership: membership }
        : name === 'crm_v2_workspace_project_sales' ? project() : name === 'crm_v2_workspace_central_search' ? central() : null });
}
beforeEach(() => {
  vi.clearAllMocks(); for (const name of ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED', 'SALES_CRM_BOOKING_ENABLED', 'SALES_CRM_PROJECT_SALES_ENABLED', 'SALES_CRM_PROJECT_WORKSPACE_ENABLED']) vi.stubEnv(name, 'true');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.invalid'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-key');
  mock.createClient.mockReturnValue({ auth: { getUser: mock.getUser }, rpc: mock.rpc, from: mock.from });
  mock.getUser.mockResolvedValue({ data: { user: { id: pid(8) } }, error: null }); configure();
});
afterEach(() => { expect(mock.from).not.toHaveBeenCalled(); vi.unstubAllEnvs(); });
describe('canonical workspace server activation', () => {
  it('uses one enriched paged reader, forwarding bank/P fields and original source scope', async () => {
    const response = await handleProjectSalesGet(request()); expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(project());
    expect(mock.rpc.mock.calls.map(call => call[0])).toEqual(['crm_v2_role', 'crm_v2_workspace_capabilities', 'crm_v2_workspace_project_sales']);
  });
  it('central/search forwards activehead metadata with no direct legacy table read', async () => {
    const response = await handleCentralGet(request('')); expect(response.status).toBe(200);
    expect((await response.json()).data.sourceMembership).toEqual(membership);
    expect(mock.rpc).toHaveBeenCalledWith('crm_v2_workspace_central_search', { p_filters: EMPTY_CENTRAL_SEARCH, p_page: 0 });
    expect(mock.rpc.mock.calls.some(call => call[0] === 'crm_v2_central_search')).toBe(false);
  });
  it.each([handleProjectSalesGet, handleCentralGet])('blocks inactive replacement without returning old rows or retrying a legacy reader', async handler => {
    configure({ crm_v2_workspace_capabilities: { data: { contract_version: WORKSPACE_READ_CONTRACT_VERSION, enabled: true, sourceMembership: { active: false, revisionId: null, originalLegacyLeadIds: [] } }, error: null } });
    const response = await handler(request(handler === handleCentralGet ? '' : scope)); expect(response.status).toBe(503);
    expect(mock.rpc.mock.calls.some(call => ['crm_v2_project_sales', 'crm_v2_central_search', 'crm_v2_workspace_project_sales', 'crm_v2_workspace_central_search'].includes(call[0]))).toBe(false);
  });
  it('fails closed if a source revision changes between capability and project snapshot', async () => {
    configure({ crm_v2_workspace_project_sales: { data: { ...project(), sourceMembership: { ...membership, revisionId: pid(92) } } } });
    expect((await handleProjectSalesGet(request())).status).toBe(503);
  });
  it('fails closed if the central wrapper is unavailable, with no old973 fallback', async () => {
    configure({ crm_v2_workspace_central_search: { error: { code: 'PGRST202' } } });
    const response = await handleCentralGet(request('')); expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('SETUP_REQUIRED');
    expect(mock.rpc.mock.calls.some(call => call[0] === 'crm_v2_central_search')).toBe(false);
  });
  it.each([handleProjectSalesGet, handleCentralGet])('never exposes source scope to an anonymous caller', async handler => {
    const response = await handler(request(handler === handleCentralGet ? '' : scope, false)); expect(response.status).toBe(401); expect(mock.rpc).not.toHaveBeenCalled();
  });
});

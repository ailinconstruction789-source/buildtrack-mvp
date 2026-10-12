import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(), getUser: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), onAuth: vi.fn(),
  rpc: vi.fn(), from: vi.fn(), core: vi.fn(),
  event: null as null | ((event: string, session: unknown) => void),
}));
vi.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getSession: mocks.getSession, getUser: mocks.getUser, signInWithPassword: mocks.signIn,
    signOut: mocks.signOut, onAuthStateChange: mocks.onAuth }, rpc: mocks.rpc, from: mocks.from,
} }));
vi.mock('@/hooks/useBuildTrackData', () => ({ useBuildTrackData: mocks.core }));
vi.mock('next/dynamic', () => ({ default: (loader: () => unknown) => {
  if (loader.toString().includes('LoginScreen')) return function Login(props: {
    loginData: { username: string; pin: string }; setLoginData: (value: unknown) => void;
    handleLogin: () => void; isLoggingIn: boolean; isLoggingOut: boolean; dialogConfig: { message?: string };
  }) { return <div>
    <span>Signed out test</span><span>{props.dialogConfig.message}</span>
    <input aria-label="Synthetic username" value={props.loginData.username}
      onChange={e => props.setLoginData({ ...props.loginData, username: e.target.value })} />
    <input aria-label="Synthetic PIN" value={props.loginData.pin}
      onChange={e => props.setLoginData({ ...props.loginData, pin: e.target.value })} />
    <button disabled={props.isLoggingIn || props.isLoggingOut} onClick={props.handleLogin}>Sign in test</button>
  </div>; };
  if (loader.toString().includes('AdminUsersView')) return () => <span>Account management test</span>;
  return () => null;
} }));
vi.mock('@/components/Sidebar', () => ({ default: (props: {
  isAdmin: boolean; isSales: boolean; setView: (value: string) => void;
}) => <div>
  <span data-testid="canonical-role">{props.isAdmin ? 'Admin' : props.isSales ? 'Sales' : 'Construction'}</span>
  <button onClick={() => props.setView('admin-users')}>Accounts test</button>
</div> }));

const userId = 'a0250000-0000-4000-8000-000000000002';
const actor = { contract: 'buildtrack.actor.v1', authUserId: userId, legacyUserId: 2,
  username: 'Synthetic Sales', role: 'Sales', canManageAccounts: false };
const session = { access_token: 'synthetic-token', user: { id: userId,
  user_metadata: { username: 'Forged Administrator', role: 'Admin', canManageAccounts: true } } };
const noop = () => {};
const coreData = {
  ...Object.fromEntries(['projects', 'houseTypes', 'taskTemplates', 'plots', 'contractors', 'allUsers',
    'assignments', 'defects', 'defectUpdates', 'notifications', 'allUpdatesRecord', 'materialRequests',
    'materialReceipts', 'inspectionQueueView', 'plotStatuses', 'plotOverallStatuses', 'qcSePerformance'].map(key => [key, []])),
  loading: false, schedules: {}, latestUpdatesMap: {}, taskDates: {}, salesDataRevision: 0,
  fetchAllData: noop, fetchPlotDetails: noop, fetchOwnerAnalyticsData: noop,
  setProjects: noop, setPlots: noop, setAllUsers: noop,
};

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  vi.stubEnv('NEXT_PUBLIC_ACCOUNT_TRUSTED_AUTH_ENABLED', 'true');
  vi.stubEnv('NEXT_PUBLIC_LEGACY_AUTHORIZATION_CUTOVER_ENABLED', 'true');
  localStorage.setItem('buildtrack_last_active', String(Date.now()));
  mocks.event = null;
  mocks.core.mockReturnValue(coreData);
  mocks.getSession.mockResolvedValue({ data: { session }, error: null });
  mocks.getUser.mockResolvedValue({ data: { user: session.user }, error: null });
  mocks.signIn.mockResolvedValue({ data: { session, user: session.user }, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.onAuth.mockImplementation(callback => {
    mocks.event = callback; return { data: { subscription: { unsubscribe: noop } } };
  });
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'app_current_actor' ? actor : null, error: null }));
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Synthetic tests have no network')));
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function openRoot() {
  const { default: Root } = await import('../../app/page');
  return render(<Root />);
}

describe('root trusted authorization cutover', () => {
  it('ignores forged metadata and runs only the trusted listener and self-presence path', async () => {
    await openRoot();
    await waitFor(() => expect(screen.getByTestId('canonical-role')).toHaveTextContent('Sales'));
    const mapped = mocks.core.mock.calls.at(-1)![0];
    expect(mapped).toEqual({ username: actor.username, role: 'Sales', id: 2,
      userId, authUserId: userId, canManageAccounts: false });
    expect(mocks.onAuth).toHaveBeenCalledOnce();
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(['app_current_actor', 'app_touch_current_user']);
    expect(mocks.getUser).toHaveBeenCalledExactlyOnceWith(session.access_token);
    expect(screen.queryByText('Forged Administrator')).not.toBeInTheDocument();
  });

  it('fails closed when the trusted RPC is unavailable, without metadata fallback', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
    await openRoot(); await screen.findByText(/ยังยืนยันสิทธิ์ของบัญชีไม่ได้/);
    expect(screen.getByText('Signed out test')).toBeInTheDocument();
    expect(screen.queryByTestId('canonical-role')).not.toBeInTheDocument();
    expect(mocks.core.mock.calls.every(([user]) => user === null)).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('app_current_actor');
  });

  it.each([undefined, 'false', 'TRUE'])('keeps legacy compatibility when the new gate is %s', async gate => {
    vi.stubEnv('NEXT_PUBLIC_LEGACY_AUTHORIZATION_CUTOVER_ENABLED', gate);
    await openRoot(); await waitFor(() => expect(screen.getByTestId('canonical-role')).toHaveTextContent('Admin'));
    expect(mocks.core.mock.calls.at(-1)![0]).toEqual(session.user.user_metadata);
    expect(mocks.getUser).not.toHaveBeenCalled(); expect(mocks.onAuth).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith('update_user_last_seen', { p_username: 'Forged Administrator' });
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'app_current_actor')).toBe(false);
  });

  it('requires the existing trusted-auth gate as well as the new cutover gate', async () => {
    vi.stubEnv('NEXT_PUBLIC_ACCOUNT_TRUSTED_AUTH_ENABLED', 'false');
    await openRoot(); await waitFor(() => expect(screen.getByTestId('canonical-role')).toHaveTextContent('Admin'));
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('restores a trusted root session inactive for two hours under the preserved 24-hour limit', async () => {
    localStorage.setItem('buildtrack_last_active', String(Date.now() - 2 * 60 * 60 * 1000));
    await openRoot(); await waitFor(() => expect(screen.getByTestId('canonical-role')).toHaveTextContent('Sales'));
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('keeps the root signed out after 24 hours of inactivity', async () => {
    localStorage.setItem('buildtrack_last_active', String(Date.now() - 24 * 60 * 60 * 1000));
    await openRoot(); await screen.findByText(/24 ชั่วโมง/);
    expect(mocks.getUser).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
  });

  it('routes explicit login through verified identity rather than returned metadata', async () => {
    mocks.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    await openRoot(); await screen.findByText('Signed out test');
    fireEvent.change(screen.getByLabelText('Synthetic username'), { target: { value: 'Synthetic Sales' } });
    fireEvent.change(screen.getByLabelText('Synthetic PIN'), { target: { value: '4321' } });
    fireEvent.click(screen.getByText('Sign in test'));
    await waitFor(() => expect(screen.getByTestId('canonical-role')).toHaveTextContent('Sales'));
    expect(mocks.signIn).toHaveBeenCalledExactlyOnceWith({ email: 'syntheticsales@buildtrack.local', password: '4321BT!' });
    expect(mocks.core.mock.calls.at(-1)![0].username).toBe(actor.username);
  });

  it('keeps an unchanged verified actor stable across refreshes', async () => {
    await openRoot(); await screen.findByTestId('canonical-role');
    const initial = mocks.core.mock.calls.at(-1)![0];
    const reads = mocks.getUser.mock.calls.length;
    await act(async () => { mocks.event!('TOKEN_REFRESHED', session); });
    await waitFor(() => expect(mocks.getUser).toHaveBeenCalledTimes(reads + 1));
    await waitFor(() => expect(mocks.core.mock.calls.at(-1)![0]).toBe(initial));
    expect(mocks.onAuth).toHaveBeenCalledOnce();
  });

  it('uses the trusted logout path and clears the root without a metadata listener', async () => {
    await openRoot(); await screen.findByTestId('canonical-role');
    fireEvent.click(screen.getByTitle('ออกจากระบบ'));
    fireEvent.click(await screen.findByText('ยืนยัน'));
    await screen.findByText('Signed out test');
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
    expect(mocks.onAuth).toHaveBeenCalledOnce();
    expect(mocks.core.mock.calls.at(-1)![0]).toBeNull();
    expect(localStorage.getItem('buildtrack_last_active')).toBeNull();
  });

  it.each(['true', 'false'])('hides account data before a slow sign-out finishes, with cutover %s', async gate => {
    vi.stubEnv('NEXT_PUBLIC_LEGACY_AUTHORIZATION_CUTOVER_ENABLED', gate);
    let finish!: (value: { error: null }) => void;
    mocks.signOut.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await openRoot(); await screen.findByTestId('canonical-role');
    fireEvent.click(screen.getByTitle('ออกจากระบบ')); fireEvent.click(await screen.findByText('ยืนยัน'));
    await screen.findByText('Signed out test');
    expect(screen.queryByTestId('canonical-role')).not.toBeInTheDocument();
    expect(screen.getByText('Sign in test')).toBeDisabled();
    expect(mocks.core.mock.calls.at(-1)![0]).toBeNull();
    await act(async () => mocks.event!('SIGNED_IN', session));
    expect(screen.queryByTestId('canonical-role')).not.toBeInTheDocument();
    await act(async () => finish({ error: null }));
    await waitFor(() => expect(screen.getByText('Sign in test')).toBeEnabled());
    expect(mocks.signOut.mock.calls[0]).toEqual(gate === 'true' ? [{ scope: 'local' }] : []);
    fireEvent.change(screen.getByLabelText('Synthetic username'), { target: { value: 'Synthetic Sales' } });
    fireEvent.change(screen.getByLabelText('Synthetic PIN'), { target: { value: '4321' } });
    fireEvent.click(screen.getByText('Sign in test'));
    await screen.findByTestId('canonical-role');
    expect(mocks.core.mock.calls.at(-1)![0].username).toBe(gate === 'true' ? actor.username : session.user.user_metadata.username);
  });

  it('ignores an old actor RPC response after another account signs in', async () => {
    let finish!:(value: { data: typeof actor; error: null }) => void;
    const nextActor = { ...actor, authUserId: 'a0250000-0000-4000-8000-000000000003',
      legacyUserId: 3, username: 'Synthetic Second Sales' };
    const nextSession = { ...session, access_token: 'synthetic-second-token', user: { ...session.user, id: nextActor.authUserId } };
    mocks.rpc.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await openRoot(); await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('app_current_actor'));
    mocks.getSession.mockResolvedValue({ data: { session: nextSession }, error: null });
    mocks.getUser.mockResolvedValue({ data: { user: nextSession.user }, error: null });
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'app_current_actor' ? nextActor : null, error: null }));
    await act(async () => { mocks.event!('SIGNED_IN', nextSession); finish({ data: actor, error: null }); });
    await waitFor(() => expect(mocks.core.mock.calls.at(-1)![0]?.username).toBe(nextActor.username));
    expect(mocks.core.mock.calls.every(([user]) => !user || user.username === nextActor.username)).toBe(true);
    expect(screen.queryByText(actor.username)).not.toBeInTheDocument();
  });

  it('does not widen account management for a reviewed Admin without that permission', async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'app_current_actor'
      ? { ...actor, role: 'Admin', canManageAccounts: false } : null, error: null }));
    await openRoot(); await waitFor(() => expect(screen.getByTestId('canonical-role')).toHaveTextContent('Admin'));
    fireEvent.click(screen.getByText('Accounts test'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 120)); });
    expect(screen.queryByText('Account management test')).not.toBeInTheDocument();
  });
});

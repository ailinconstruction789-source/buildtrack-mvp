import { act,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import { describe,it,expect,vi,afterEach } from 'vitest';
import AccountAccessView from '../AccountAccessView';
import AccountAccessPage from '@/app/admin/account-access/page';
import DirectoryDemoPage from '@/app/dev/account-access/directory/page';
import { aid,snapshot } from '@/lib/auth/__tests__/accountAccessFixtures';
import type { AccountAccessApi } from '@/lib/auth/accountAccessClient';
vi.mock('@/lib/auth/accountAccessClient',()=>({accountAccessApi:{read:vi.fn(),watch:vi.fn()}}));
vi.mock('@/lib/auth/accountRestoreClient',()=>({restoreAccountAccess:vi.fn()}));
vi.mock('next/navigation',()=>({notFound:()=>{throw new Error('NOT_FOUND');}}));
afterEach(()=>vi.unstubAllEnvs());
function fake() {
  let invalidated=()=>{};
  const unwatch=vi.fn();const read=vi.fn().mockResolvedValue(snapshot());
  const api:AccountAccessApi={read,watch:fn=>{invalidated=fn;return unwatch;}};
  return {api,read,unwatch,invalidate:()=>invalidated()};
}
describe('account access read-only workspace',()=>{
  it('shows only status/latest evidence, with no mutation controls',async()=>{
    const f=fake();render(<AccountAccessView api={f.api}/>);
    await screen.findByRole('heading',{name:'Sales สมมติ'});
    expect(within(screen.getByRole('article')).getByText('รอ Admin รับรองใหม่')).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/เปิดสิทธิ์|รับรอง|แบน|ลบ/})).not.toBeInTheDocument();
  });
  it('filters from page zero and hides old data while new request is pending',async()=>{
    const f=fake();render(<AccountAccessView api={f.api}/>);await screen.findByRole('heading',{name:'Sales สมมติ'});
    f.read.mockReturnValueOnce(new Promise(()=>{}));fireEvent.change(screen.getByLabelText('ค้นหาชื่อบัญชี'),{target:{value:'example'}});
    fireEvent.click(screen.getByRole('button',{name:'ค้นหา'}));
    expect(screen.queryByRole('heading',{name:'Sales สมมติ'})).not.toBeInTheDocument();
    await waitFor(()=>expect(f.read).toHaveBeenLastCalledWith({page:0,query:'example',status:'all'}));
  });
  it('invalidates visible data immediately on auth change; late results cannot reappear',async()=>{
    const f=fake();let resolve!:(value:ReturnType<typeof snapshot>)=>void;
    f.read.mockReturnValueOnce(new Promise(accept=>{resolve=accept;}));render(<AccountAccessView api={f.api}/>);
    await waitFor(()=>expect(f.read).toHaveBeenCalledOnce());
    f.read.mockRejectedValueOnce(new Error('กรุณาเข้าสู่ระบบใหม่'));
    act(()=>f.invalidate());await screen.findByRole('alert');
    await act(async()=>resolve(snapshot({actorId:aid(1)})));
    expect(screen.queryByRole('heading',{name:'Sales สมมติ'})).not.toBeInTheDocument();
  });
  it('clears existing accounts on logout and cleans up the subscription',async()=>{
    const f=fake();const view=render(<AccountAccessView api={f.api}/>);await screen.findByRole('heading',{name:'Sales สมมติ'});
    f.read.mockRejectedValue(new Error('กรุณาเข้าสู่ระบบใหม่'));act(()=>f.invalidate());
    expect(screen.queryByRole('heading',{name:'Sales สมมติ'})).not.toBeInTheDocument();await screen.findByRole('alert');
    view.unmount();expect(f.unwatch).toHaveBeenCalledOnce();
  });
  it('does not mount the reader when deployment switches are closed',()=>{
    vi.stubEnv('ACCOUNT_ACCESS_READ_ENABLED','false');render(<AccountAccessPage/>);
    expect(screen.getByRole('status')).toHaveTextContent('ยังไม่เรียก Supabase');
    expect(screen.queryByLabelText('ค้นหาชื่อบัญชี')).not.toBeInTheDocument();
  });
  it('demonstrates the same view without live data and supports filtering',async()=>{
    vi.stubEnv('NODE_ENV','development');render(<DirectoryDemoPage/>);
    await screen.findByRole('heading',{name:'Sales ตัวอย่าง A'});
    expect(screen.getAllByRole('article')).toHaveLength(5);
    fireEvent.change(screen.getByLabelText('สถานะสิทธิ์'),{target:{value:'awaiting_review'}});
    fireEvent.click(screen.getByRole('button',{name:'ค้นหา'}));
    await screen.findByRole('heading',{name:'Sales ตัวอย่าง B'});expect(screen.getAllByRole('article')).toHaveLength(1);
  });
  it('refuses the directory demo in production',()=>{
    vi.stubEnv('NODE_ENV','production');expect(()=>DirectoryDemoPage()).toThrow('NOT_FOUND');
  });
});

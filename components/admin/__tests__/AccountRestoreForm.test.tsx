import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import AccountAccessView from '../AccountAccessView';
import DirectoryDemo from '@/components/dev/AccountAccessDirectoryDemo';
import {snapshot} from '@/lib/auth/__tests__/accountAccessFixtures';
import {RestoreError,type RestoreRequest,type RestoreReceipt} from '@/lib/auth/accountRestoreContracts';
const reply=(input:RestoreRequest):RestoreReceipt=>({contract:'buildtrack.account-restore.v1',requestId:input.requestId,actorId:input.actorId,
  userId:input.userId,reviewedRevision:input.expectedRevision+1,reviewedAt:'2026-09-25T09:00:00Z'});
function fake(){
  let invalidated=()=>{};
  const read=vi.fn().mockResolvedValue(snapshot()),restore=vi.fn().mockImplementation(async(input:RestoreRequest)=>reply(input));
  return {api:{read,watch:(fn:()=>void)=>{invalidated=fn;return()=>{};}},restore,invalidate:()=>invalidated()};
}
async function open(){await screen.findByRole('button',{name:'ตรวจและรับรองคืนสิทธิ์'});fireEvent.click(screen.getByRole('button',{name:'ตรวจและรับรองคืนสิทธิ์'}));}
function fill(){fireEvent.change(screen.getByLabelText(/เหตุผล \/ หลักฐาน/),{target:{value:'ตรวจสอบตัวตนและความพร้อมแล้ว'}});fireEvent.click(screen.getByRole('checkbox'));}
describe('Sales restoration presentation',()=>{
  it('requires reason and human attestation before submitting',async()=>{
    const f=fake();render(<AccountAccessView api={f.api} restore={f.restore}/>);await open();
    const submit=screen.getByRole('button',{name:'ยืนยันรับรองคืนสิทธิ์'});expect(submit).toBeDisabled();fill();fireEvent.click(submit);
    await screen.findByText(/บันทึกการรับรองแล้ว/);expect(f.restore).toHaveBeenCalledOnce();expect(f.restore.mock.calls[0][0]).toMatchObject({expectedRevision:1,confirmed:true});
    expect(await screen.findByText(/ให้ดูสถานะปัจจุบัน/)).toBeInTheDocument();
  });
  it('uncertain outcome freezes input and retries same id/payload; double clicks cannot send twice',async()=>{
    const f=fake();let reject!:(error:Error)=>void;
    f.restore.mockReturnValueOnce(new Promise((_,no)=>{reject=no;}));render(<AccountAccessView api={f.api} restore={f.restore}/>);await open();fill();
    const submit=screen.getByRole('button',{name:'ยืนยันรับรองคืนสิทธิ์'});fireEvent.click(submit);fireEvent.click(submit);
    expect(f.restore).toHaveBeenCalledOnce();await act(async()=>reject(new RestoreError('RESULT_UNKNOWN')));
    expect(screen.getByLabelText(/เหตุผล \/ หลักฐาน/)).toBeDisabled();expect(screen.getByRole('button',{name:'ปิดและโหลดรายการใหม่'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'ส่งคำขอเดิมเพื่อตรวจผล'}));await screen.findByText(/บันทึกการรับรองแล้ว/);
    expect(f.restore.mock.calls[0][0]).toEqual(f.restore.mock.calls[1][0]);
  });
  it('focus/periodic directory refresh does not discard pending command',async()=>{
    const f=fake();f.restore.mockRejectedValueOnce(new RestoreError('RESULT_UNKNOWN'));
    render(<AccountAccessView api={f.api} restore={f.restore}/>);await open();fill();fireEvent.click(screen.getByRole('button',{name:'ยืนยันรับรองคืนสิทธิ์'}));
    await screen.findByRole('alert');fireEvent.focus(window);await waitFor(()=>expect(f.api.read).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button',{name:'ส่งคำขอเดิมเพื่อตรวจผล'})).toBeInTheDocument();
  });
  it('hides form on auth invalidation and discards late mutation result',async()=>{
    const f=fake();let resolve!:(value:RestoreReceipt)=>void;f.restore.mockReturnValueOnce(new Promise(yes=>{resolve=yes;}));
    render(<AccountAccessView api={f.api} restore={f.restore}/>);await open();fill();fireEvent.click(screen.getByRole('button',{name:'ยืนยันรับรองคืนสิทธิ์'}));
    f.api.read.mockRejectedValue(new Error('signed out'));act(()=>f.invalidate());expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await act(async()=>resolve(reply(f.restore.mock.calls[0][0])));expect(screen.queryByText(/บันทึกการรับรองแล้ว/)).not.toBeInTheDocument();
  });
  it('stale-revision rejection cannot be blindly retried',async()=>{
    const f=fake();f.restore.mockRejectedValueOnce(new RestoreError('STATE_CHANGED'));
    render(<AccountAccessView api={f.api} restore={f.restore}/>);await open();fill();fireEvent.click(screen.getByRole('button',{name:'ยืนยันรับรองคืนสิทธิ์'}));
    await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'ส่งคำขอเดิมเพื่อตรวจผล'})).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'ปิดและโหลดรายการใหม่'})).toBeEnabled();
  });
  it('same form demo restores B only; keeps suspension evidence and resets on remount',async()=>{
    const view=render(<DirectoryDemo/>);await open();fill();fireEvent.click(screen.getByRole('button',{name:'ยืนยันรับรองคืนสิทธิ์'}));
    await screen.findByText(/บันทึกการรับรองแล้ว/);
    await waitFor(()=>{
      const card=screen.getAllByRole('article').find(row=>within(row).queryByRole('heading',{name:'Sales ตัวอย่าง B'}))!;
      expect(within(card).getByText('เปิดใช้งาน')).toBeInTheDocument();expect(within(card).getByText(/บัญชีถูกแบน/)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button',{name:'ตรวจและรับรองคืนสิทธิ์'})).not.toBeInTheDocument();
    view.unmount();render(<DirectoryDemo/>);expect(await screen.findByRole('button',{name:'ตรวจและรับรองคืนสิทธิ์'})).toBeInTheDocument();
  });
});

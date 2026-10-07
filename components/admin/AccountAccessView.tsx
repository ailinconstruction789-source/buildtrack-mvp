'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { AccountAccessApi } from '@/lib/auth/accountAccessClient';
import { ACCESS_LABELS, ACCESS_STATES, type AccessAccount, type AccessQuery, type AccessSnapshot } from '@/lib/auth/accountAccessContracts';
import type { RestoreApi } from '@/lib/auth/accountRestoreContracts';
import AccountRestoreForm from './AccountRestoreForm';

const button = 'rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-40';
const authLabels = {available:'ใช้ได้',banned:'ถูกแบน',deleted:'ปิดบัญชีแล้ว',anonymous:'บัญชีไม่ระบุตัวตน',missing:'ไม่พบบัญชี'};
const reasonLabels = {auth_banned:'บัญชีถูกแบน',auth_deleted:'บัญชีถูกปิด',auth_anonymous:'บัญชีเปลี่ยนเป็นไม่ระบุตัวตน'};
const date = (value: string) => new Date(value).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'});

export default function AccountAccessView({ api, restore }: { api: AccountAccessApi; restore?: RestoreApi }) {
  const [selection,setSelection]=useState<{account:AccessAccount;actorId:string}|null>(null);
  const [authNotice,setAuthNotice]=useState(false);
  const [scope,setScope] = useState<AccessQuery>({page:0,query:'',status:'all'});
  const [search,setSearch] = useState('');
  const [filter,setFilter] = useState<AccessQuery['status']>('all');
  const [retry,setRetry] = useState(0);
  const [state,setState] = useState<{data:AccessSnapshot|null;error:string|null;loading:boolean}>({data:null,error:null,loading:true});
  useEffect(() => {
    let disposed=false, generation=0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const ticket=++generation;
      setState({data:null,error:null,loading:true});
      try {
        const data=await api.read(scope);
        if (!disposed && ticket===generation) setState({data,error:null,loading:false});
      } catch (error) {
        if (!disposed && ticket===generation) setState({data:null,error:error instanceof Error ? error.message : 'โหลดข้อมูลไม่ได้',loading:false});
      }
    };
    const invalidate = () => {
      if (disposed) return;
      generation++;
      setState({data:null,error:null,loading:true});
      if (timer) clearTimeout(timer);
      timer=setTimeout(() => { void load(); },0);
    };
    let unwatch: () => void;
    try { unwatch=api.watch(()=>{setSelection(null);setAuthNotice(true);invalidate();}); }
    catch {
      timer=setTimeout(()=>{ if (!disposed) setState({data:null,error:'ตรวจการเปลี่ยนบัญชีไม่ได้ กรุณาโหลดหน้าใหม่',loading:false}); },0);
      return ()=>{ disposed=true; if (timer) clearTimeout(timer); };
    }
    timer=setTimeout(()=>{ void load(); },0);
    window.addEventListener('focus',invalidate);
    const visibility=() => { if (document.visibilityState==='visible') invalidate(); };
    document.addEventListener('visibilitychange',visibility);
    const interval=setInterval(invalidate,60_000);
    return () => { disposed=true; generation++; unwatch(); if (timer) clearTimeout(timer); clearInterval(interval);
      window.removeEventListener('focus',invalidate); document.removeEventListener('visibilitychange',visibility); };
  },[api,scope,retry]);
  const apply = (event: FormEvent) => { event.preventDefault(); setState({data:null,error:null,loading:true}); setScope({page:0,query:search.trim(),status:filter}); };
  const changePage = (page: number) => { setState({data:null,error:null,loading:true}); setScope({...scope,page}); };
  return <section aria-label="ตรวจสิทธิ์ฝ่ายขาย" className="space-y-5">
    {authNotice && <p role="status" className="rounded-xl bg-amber-50 p-4 text-sm">บัญชีหรือเซสชันเปลี่ยนแล้ว จึงปิดแบบรับรองเดิม หากส่งคำขอไปแล้วให้ตรวจสถานะล่าสุดก่อนทำรายการอีกครั้ง</p>}
    {selection && restore && <AccountRestoreForm key={`${selection.actorId}:${selection.account.userId}:${selection.account.revision}`}
      {...selection} restore={restore} onRecorded={()=>setRetry(value=>value+1)}
      onClose={()=>{setSelection(null);setRetry(value=>value+1);}}/>}
    <form onSubmit={apply} className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex sm:flex-wrap sm:items-end">
      <label className="col-span-2 min-w-0 text-sm font-semibold sm:min-w-[12rem] sm:flex-1">ค้นหาชื่อบัญชี
        <input value={search} maxLength={80} onChange={event=>setSearch(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2" />
      </label>
      <label className="col-span-2 min-w-0 text-sm font-semibold">สถานะสิทธิ์
        <select value={filter} onChange={event=>setFilter(event.target.value as AccessQuery['status'])} className="mt-2 block w-full max-w-full rounded-xl border border-slate-300 px-3 py-2">
          <option value="all">ทุกสถานะ</option>{ACCESS_STATES.map(key=><option key={key} value={key}>{ACCESS_LABELS[key]}</option>)}
        </select>
      </label>
      <button className={button} type="submit">ค้นหา</button>
      <button className={button} type="button" onClick={()=>{setState({data:null,error:null,loading:true});setRetry(value=>value+1);}}>โหลดใหม่</button>
    </form>
    {state.loading && <p role="status">กำลังตรวจสิทธิ์…</p>}
    {state.error && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-amber-900">{state.error}</p>}
    {state.data && <>
      <p className="text-sm text-slate-600">พบ {state.data.total} บัญชี · ตรวจข้อมูลเมื่อ {date(state.data.generatedAt)} · {restore?'รับรองได้เฉพาะ Sales ที่รอทบทวน':'อ่านอย่างเดียว'}</p>
      {state.data.accounts.length===0 && <p role="status">ไม่พบบัญชีฝ่ายขายที่รับรองแล้วตามตัวกรองนี้</p>}
      <div className="space-y-3">{state.data.accounts.map(account=><article key={account.userId} className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><h2 className="break-all text-lg font-bold">{account.username}</h2>
          <span className={`rounded-lg px-3 py-1 text-sm font-semibold ${account.status==='active'?'bg-emerald-50 text-emerald-800':'bg-amber-50 text-amber-900'}`}>{ACCESS_LABELS[account.status]}</span></div>
        <dl className="mt-4 grid gap-x-5 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
          <dt className="text-slate-500">สถานะบัญชี Auth</dt><dd>{authLabels[account.authStatus]}</dd>
          <dt className="text-slate-500">รับรองล่าสุด</dt><dd>{date(account.reviewedAt)} · รุ่น {account.revision}</dd>
          <dt className="text-slate-500">เหตุพักสิทธิ์ล่าสุดที่บันทึก</dt><dd>{account.lastSuspension
            ? `${reasonLabels[account.lastSuspension.reason]} · ${date(account.lastSuspension.at)} · รุ่น ${account.lastSuspension.revision}` : 'ไม่มีหลักฐานพักสิทธิ์ในระบบนี้'}</dd>
        </dl>
        {restore && account.status==='awaiting_review' && account.revision>0 && account.authStatus==='available'
          ? <button type="button" className={`${button} mt-4 text-blue-800`} disabled={!!selection}
            onClick={()=>{setAuthNotice(false);setSelection({account,actorId:state.data!.actorId});}}>ตรวจและรับรองคืนสิทธิ์</button>
          : account.status!=='active' && <p className="mt-4 text-sm text-slate-600">ยังรับรองจากหน้านี้ไม่ได้ โปรดตรวจสถานะบัญชีและสิทธิ์ก่อน หน้านี้ไม่มีคำสั่งปลดแบนหรือเปลี่ยนบทบาท</p>}
      </article>)}</div>
      <nav aria-label="หน้ารายการบัญชี" className="flex items-center gap-3">
        <button className={button} disabled={scope.page===0} onClick={()=>changePage(scope.page-1)}>ก่อนหน้า</button>
        <span className="text-sm">หน้า {scope.page+1}</span>
        <button className={button} disabled={(scope.page+1)*25>=state.data.total || scope.page>=10000} onClick={()=>changePage(scope.page+1)}>ถัดไป</button>
      </nav>
    </>}
  </section>;
}

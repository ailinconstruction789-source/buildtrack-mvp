'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AccessAccount } from '@/lib/auth/accountAccessContracts';
import { parseRestoreRequest, parseRestoreReceipt, RestoreError, type RestoreApi, type RestoreRequest, type RestoreReceipt } from '@/lib/auth/accountRestoreContracts';

const button='rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-40';
export default function AccountRestoreForm({account,actorId,restore,onRecorded,onClose}: {
  account:AccessAccount;actorId:string;restore:RestoreApi;onRecorded:()=>void;onClose:()=>void;
}) {
  const [reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false);
  const [pending,setPending]=useState<RestoreRequest|null>(null),[busy,setBusy]=useState(false);
  const [error,setError]=useState<RestoreError|null>(null),[receipt,setReceipt]=useState<RestoreReceipt|null>(null);
  const inFlight=useRef(false),alive=useRef(true);
  const panel=useRef<HTMLElement>(null),reasonInput=useRef<HTMLInputElement>(null);
  useEffect(()=>{
    alive.current=true;panel.current?.scrollIntoView?.({block:'start'});reasonInput.current?.focus({preventScroll:true});
    return()=>{alive.current=false;};
  },[]);
  const submit=async(event:FormEvent)=>{
    event.preventDefault(); if(inFlight.current || receipt) return;
    let command:RestoreRequest;
    try {
      command=pending??parseRestoreRequest({requestId:crypto.randomUUID(),actorId,userId:account.userId,
        expectedRevision:account.revision,expectedUsername:account.username,reason,confirmed});
    } catch {setError(new RestoreError('INVALID_INPUT'));return;}
    inFlight.current=true;setBusy(true);setPending(command);setError(null);
    try {
      const result=parseRestoreReceipt(await restore(command),command);
      if (alive.current) {setReceipt(result);onRecorded();}
    } catch (failure) {
      if (alive.current) setError(failure instanceof RestoreError?failure:new RestoreError('RESULT_UNKNOWN'));
    } finally {inFlight.current=false;if(alive.current)setBusy(false);}
  };
  const uncertain=error?.code==='RESULT_UNKNOWN';
  return <section ref={panel} aria-label="รับรองคืนสิทธิ์ Sales" className="scroll-mt-4 rounded-2xl border-2 border-blue-300 bg-blue-50 p-5">
    <h2 className="text-lg font-bold">รับรองคืนสิทธิ์: {account.username}</h2>
    <p className="mt-2 text-sm">เฉพาะสิทธิ์ Sales เดิม ไม่ปลดแบน ไม่เปลี่ยนบทบาท และไม่ย้าย Lead</p>
    <p className="mt-2 break-all text-xs text-slate-600">รหัสบัญชี {account.userId} · รุ่นที่ตรวจ {account.revision}</p>
    {receipt ? <div className="mt-4 space-y-3">
      <p role="status" className="font-semibold text-emerald-800">บันทึกการรับรองแล้ว · รุ่น {receipt.reviewedRevision}</p>
      <p className="text-sm">นี่คือหลักฐานการรับรองครั้งนี้ ให้ดูสถานะปัจจุบันในรายการด้านล่าง บัญชีอาจถูกพักสิทธิ์อีกภายหลังได้</p>
      <p className="break-all text-xs">เลขคำขอ {receipt.requestId}</p>
      <button type="button" className={button} onClick={onClose}>ปิดผลการรับรอง</button>
    </div> : <form onSubmit={submit} className="mt-4 space-y-4">
      <label className="block text-sm font-semibold">เหตุผล / หลักฐานอ้างอิงการรับรอง (8–500 ตัวอักษร)
        <input ref={reasonInput} value={reason} disabled={!!pending} minLength={8} maxLength={500} required onChange={event=>setReason(event.target.value)}
          className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 disabled:bg-slate-100"/>
      </label>
      <p className="text-xs text-slate-600">ระบุข้อมูลอ้างอิงที่จำเป็นเท่านั้น ไม่ใส่รหัสผ่าน PIN หรือข้อมูลส่วนตัวลูกค้า</p>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={confirmed} disabled={!!pending} required
        onChange={event=>setConfirmed(event.target.checked)} className="mt-1 h-4 w-4 shrink-0"/>
        ฉันตรวจสอบตัวตน เหตุพักสิทธิ์ และความพร้อมกลับมาปฏิบัติงานแล้ว</label>
      {error && <p role="alert" className="rounded-xl bg-amber-100 p-3 text-sm text-amber-950">{error.message}</p>}
      {pending && <p className="break-all text-xs">เลขคำขอ {pending.requestId}</p>}
      {uncertain && <p className="text-sm">อย่าปิดหรือรีเฟรชหน้านี้ระหว่างตรวจผล การส่งซ้ำจะใช้เลขเดิมและไม่บันทึกการรับรองเพิ่ม</p>}
      <div className="flex flex-wrap gap-3">
        {(!error || uncertain || !pending) && <button type="submit" className={`${button} bg-blue-700 text-white`}
          disabled={busy || !confirmed || reason.trim().length<8}>{busy?'กำลังตรวจและบันทึก…':pending?'ส่งคำขอเดิมเพื่อตรวจผล':'ยืนยันรับรองคืนสิทธิ์'}</button>}
        <button type="button" className={button} disabled={busy || uncertain} onClick={onClose}>{pending?'ปิดและโหลดรายการใหม่':'ยกเลิก'}</button>
      </div>
    </form>}
  </section>;
}

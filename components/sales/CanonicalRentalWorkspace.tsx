'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { rentalCommandApi, RentalCommandApiError, type RentalCommandApi } from '@/lib/sales/rentalCommandClient';
import { type RentalCommandInput, type RentalCommandScope, type RentalCommandSnapshot } from '@/lib/sales/rentalCommandContracts';
import { readRentalCommandPending, writeRentalCommandPending, clearRentalCommandPending, RentalCommandPendingError } from '@/lib/sales/rentalCommandPending';
import { displayTransferDate } from '@/lib/sales/postBookingContracts';
import { displayBangkokTime } from '@/lib/sales/leadWorkDates';
import { bookingButtonClass } from './BookingForm';
import CanonicalRentalForm, { rentalCommandLabels, rentalPaymentLabels, rentalProgramLabels } from './CanonicalRentalForm';

interface Props { customerId: string; projectName: string; contractId?: string | null; api?: RentalCommandApi }
interface Pending { actor:string; input:RentalCommandInput; uncertain:boolean }
const money=(satang:number)=>`${(satang/100).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท`;
const rentalDate=(day:string|null)=>day===null?'ไม่ทราบวันที่':displayTransferDate(day);
const statusLabels={active:'ใช้งาน',renewed:'ต่อสัญญาแล้ว',converted:'เปลี่ยนเป็นซื้อแล้ว',ended:'สิ้นสุดแล้ว'};
export default function CanonicalRentalWorkspace(props:Props) {
  const [identityEpoch,setIdentityEpoch]=useState(0);
  const api=props.api??rentalCommandApi;
  useEffect(()=>api.watchIdentity?.(()=>setIdentityEpoch(value=>value+1)),[api]);
  return <RentalSession key={`${props.customerId}:${props.projectName}:${props.contractId??''}:${identityEpoch}`} {...props} api={api}/>;
}
function RentalSession({customerId,projectName,contractId:initialContract=null,api=rentalCommandApi}:Props) {
  const [scope,setScope]=useState<RentalCommandScope>({customerId,projectName,contractId:initialContract,contractPage:0,eventPage:0,paymentPage:0,plotPage:0});
  const [revision,setRevision]=useState(0),[loaded,setLoaded]=useState<{key:string;api?:RentalCommandApi;snapshot?:RentalCommandSnapshot;error?:string}>({key:''});
  const [command,setCommand]=useState<RentalCommandInput['command']|null>(null),[pending,setPending]=useState<Pending|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[storageError,setStorageError]=useState(''),[notice,setNotice]=useState('');
  const mounted=useRef(false),writing=useRef(false),pendingRef=useRef<Pending|null>(null),storageBlocked=useRef(false),successfulReceipt=useRef(false),recoveredActor=useRef('');
  const key=JSON.stringify(scope)+':'+revision;
  const snapshot=loaded.key===key&&loaded.api===api?loaded.snapshot:undefined;
  const mayEdit=!!snapshot&&snapshot.interest.canEdit&&snapshot.actor.role!=='owner'&&(snapshot.actor.role==='admin'||snapshot.actor.userId===snapshot.interest.ownerUserId);
  const locked=!!pending||busy||!!storageError;
  const setReceipt=(value:Pending|null)=>{pendingRef.current=value;if(mounted.current)setPending(value);};
  const blockStorage=(failure:unknown)=>{storageBlocked.current=true;if(mounted.current)setStorageError(failure instanceof Error?failure.message:'ตรวจคำขอค้างไม่ได้ กรุณาให้ Admin ตรวจสอบ');};
  useEffect(()=>{
    mounted.current=true;
    const blocked=()=>!!pendingRef.current||writing.current||storageBlocked.current||successfulReceipt.current;
    const unload=(event:BeforeUnloadEvent)=>{if(blocked()){event.preventDefault();event.returnValue='';}};
    const nav=(event:MouseEvent)=>{if(blocked()&&event.target instanceof Element&&event.target.closest('a[href]')){event.preventDefault();event.stopPropagation();}};
    window.addEventListener('beforeunload',unload);document.addEventListener('click',nav,true);
    return()=>{mounted.current=false;window.removeEventListener('beforeunload',unload);document.removeEventListener('click',nav,true);};
  },[]);
  useEffect(()=>{
    let cancelled=false;const controller=new AbortController();
    api.read(scope,{signal:controller.signal}).then(value=>{
      if(cancelled)return;
      try{
        if(pendingRef.current&&pendingRef.current.actor!==value.actor.userId)throw new RentalCommandPendingError();
        if(recoveredActor.current!==value.actor.userId){
          const input=readRentalCommandPending(value.actor.userId);recoveredActor.current=value.actor.userId;
          if(input)setReceipt({actor:value.actor.userId,input,uncertain:true});
        }
      }catch(failure){setPending(null);blockStorage(failure);setLoaded({key,api,error:'ไม่แสดงข้อมูลบัญชีใหม่จนกว่าจะตรวจคำขอค้างได้'});return;}
      setLoaded({key,api,snapshot:value});
    }).catch(failure=>{if(!cancelled)setLoaded({key,api,error:failure instanceof Error?failure.message:'โหลดข้อมูลเช่าไม่ได้'});});
    return()=>{cancelled=true;controller.abort();};
  },[api,scope,key]);
  const save=async(input:RentalCommandInput)=>{
    if(writing.current||storageBlocked.current||successfulReceipt.current||!snapshot||snapshot.actor.role==='owner')return;
    const existing=pendingRef.current;
    if(existing?existing.actor!==snapshot.actor.userId:!mayEdit||input.customerId!==customerId||input.projectName!==projectName||input.interestId!==snapshot.interest.id)return;
    writing.current=true;setBusy(true);setError('');setNotice('');const actor=existing?.actor??snapshot.actor.userId;
    let receipt:Pending;
    try{receipt={actor,input:writeRentalCommandPending(actor,existing?.input??input),uncertain:existing?.uncertain??false};setReceipt(receipt);}
    catch(failure){blockStorage(failure);writing.current=false;setBusy(false);return;}
    try{
      const result=await api.save(receipt.input,actor);successfulReceipt.current=true;
      try{clearRentalCommandPending(actor,receipt.input);}catch(failure){if(mounted.current)setNotice(`บันทึกสำเร็จแล้ว · สัญญา ${result.contractId} · ห้ามส่งซ้ำ`);blockStorage(failure);return;}
      setReceipt(null);successfulReceipt.current=false;
      if(mounted.current){setNotice(`บันทึกสำเร็จแล้ว · สัญญา ${result.contractId} · กำลังอ่านข้อมูลล่าสุด`);setCommand(null);
        if(receipt.input.customerId===customerId&&receipt.input.projectName===projectName)setScope(value=>({...value,contractId:result.contractId,eventPage:0,paymentPage:0}));
        setRevision(value=>value+1);
      }
    }catch(failure){
      if(failure instanceof RentalCommandApiError&&failure.definitelyNotSaved&&!receipt.uncertain){try{clearRentalCommandPending(actor,receipt.input);setReceipt(null);}catch(storageFailure){blockStorage(storageFailure);}}
      else setReceipt({...receipt,uncertain:true});
      if(mounted.current)setError(failure instanceof Error?failure.message:'ยังยืนยันผลบันทึกไม่ได้');
    }finally{writing.current=false;if(mounted.current)setBusy(false);}
  };
  const navigate=(changes:Partial<RentalCommandScope>)=>{if(locked||writing.current||pendingRef.current||storageBlocked.current||successfulReceipt.current)return;setCommand(null);setError('');setScope(value=>({...value,...changes}));};
  const paging=(field:'contractPage'|'eventPage'|'paymentPage'|'plotPage',hasMore:boolean,label:string)=><div className="flex flex-wrap gap-3"><button className={bookingButtonClass} disabled={locked||scope[field]===0} onClick={()=>navigate({[field]:scope[field]-1})}>{label}ก่อนหน้า</button><button className={bookingButtonClass} disabled={locked||!hasMore} onClick={()=>navigate({[field]:scope[field]+1})}>{label}ถัดไป</button></div>;
  const selected=snapshot?.selectedContract;
  const active=!!selected&&['active','renewed'].includes(selected.status);
  const canStart=!!snapshot&&mayEdit&&!selected&&!snapshot.contracts.some(item=>['active','renewed'].includes(item.status));
  const actions:RentalCommandInput['command'][]=mayEdit?(active?['renew','record_payment','convert_to_buy','end']:canStart?['start']:[]):[];
  return <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-8">
    <header className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-bold">สัญญาเช่า A / B / C</h1><p className="text-sm text-slate-600">ลูกค้าคนเดียว · ประวัติสัญญาและเงินรับแยกตามรอบ</p></div>{!locked?<nav className="flex flex-wrap gap-4 text-blue-700 underline" aria-label="ไปยังส่วนงานขาย"><Link href="/sales-crm" prefetch={false}>Lead ส่วนกลาง</Link><Link href={`/sales-crm/projects?projectName=${encodeURIComponent(projectName)}`} prefetch={false}>ลูกค้าในโครงการ</Link></nav>:<p>ตรวจผลคำขอค้างก่อนออกจากหน้านี้</p>}</header>
    <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">ยอดเงินตามสัญญาแยกจากเงินที่รับจริง การคืนเงินหรือจัดสรรเงินออม/เงินประกันยังต้องดำเนินการแยก ไม่มีการชำระบัญชีอัตโนมัติ</p>
    {notice&&<p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">{notice}</p>}{(error||storageError)&&<p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-800">{storageError||error}</p>}
    {pending&&<section aria-label="คำขอเช่าค้าง" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4"><h2 className="font-bold">มีคำขอที่ต้องตรวจผลก่อนเริ่มรายการใหม่</h2><p className="break-all text-sm">คำขอ {pending.input.requestId} · {rentalCommandLabels[pending.input.command]} · ลูกค้า {pending.input.customerId} · สัญญา {pending.input.contractId??'เริ่มใหม่'}</p>
      {(pending.input.customerId!==customerId||pending.input.projectName!==projectName)&&<p>คำขอนี้เป็นของลูกค้าหรือโครงการอื่น การตรวจผลจะใช้ข้อมูลเดิมเท่านั้น</p>}
      <p className="text-sm">ห้ามล้างข้อมูลแท็บ หากเปลี่ยนบัญชีให้กลับเข้าบัญชีผู้ทำรายการเดิม</p><button className={bookingButtonClass} disabled={busy||!!storageError||!snapshot||snapshot.actor.role==='owner'||pending.actor!==snapshot.actor.userId} onClick={()=>void save(pending.input)}>{busy?'กำลังตรวจผล…':'ตรวจผลซ้ำด้วยคำขอเดิม'}</button></section>}
    {!snapshot?loaded.key===key&&loaded.api===api&&loaded.error?<section role="alert" className="space-y-3 rounded-lg border p-4"><p>{loaded.error}</p><p>ไม่แสดงข้อมูลเก่าแทน และการโหลดใหม่ไม่ส่งคำขอบันทึก</p><button className={bookingButtonClass} disabled={busy} onClick={()=>setRevision(value=>value+1)}>โหลดข้อมูลใหม่</button></section>:<p role="status">กำลังโหลดข้อมูลสัญญาเช่า…</p>:<>
      <section aria-label="ข้อมูลลูกค้าเช่า" className="space-y-3 rounded-xl border bg-white p-5"><h2 className="text-xl font-bold">{snapshot.customer.name}</h2><p>{snapshot.interest.projectName} · โทร {snapshot.customer.phone??'ไม่ทราบ'}</p><p className="break-all text-xs text-slate-500">รหัสลูกค้า {snapshot.customer.id} · ผู้รับผิดชอบ {snapshot.interest.ownerUserId}</p>{snapshot.actor.role==='owner'?<p>Owner ดูข้อมูลได้อย่างเดียว</p>:!mayEdit&&<p>บัญชีนี้ดูประวัติได้ แต่ยังไม่เปิดให้บันทึก</p>}
        <div className="flex flex-wrap gap-3">{actions.map(value=><button key={value} className={bookingButtonClass} disabled={locked} onClick={()=>{setCommand(value);setError('');}}>{rentalCommandLabels[value]}</button>)}<button className={bookingButtonClass} disabled={locked} onClick={()=>{setCommand(null);setRevision(value=>value+1);}}>โหลดประวัติล่าสุด</button>{selected&&<button className={bookingButtonClass} disabled={locked} onClick={()=>navigate({contractId:null,eventPage:0,paymentPage:0})}>กลับรายการสัญญา</button>}</div>
      </section>
      {selected&&<section aria-label="สัญญาที่เลือก" className="space-y-3 rounded-xl border bg-white p-5"><h2 className="text-lg font-bold">โปรแกรม {rentalProgramLabels[selected.programType]} · แปลง {selected.plotId} · {statusLabels[selected.status]}</h2><p>เริ่ม {displayTransferDate(selected.startDate)} · ครบสัญญา {displayTransferDate(selected.endDate)}</p><dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt>ค่าเช่าต่อเดือนตามสัญญา</dt><dd>{money(selected.monthlyRentSatang)}</dd></div><div><dt>เงินประกันตามสัญญา</dt><dd>{money(selected.securityDepositSatang)}</dd></div><div><dt>เงินประกันรับจริงที่มีหลักฐาน</dt><dd>{money(selected.confirmedDepositSatang)}</dd></div><div><dt>เงินออมรับจริงที่มีหลักฐาน</dt><dd>{money(selected.confirmedSavingsSatang)}</dd></div><div><dt>ค่าเช่าล่วงหน้าตามสัญญา</dt><dd>{money(selected.advanceRentSatang)}</dd></div><div><dt>เงินออมต่อเดือนตามสัญญา</dt><dd>{money(selected.savingsPerMonthSatang)}</dd></div><div><dt>ราคาฐานตามสัญญา</dt><dd>{selected.basePriceSatang===null?'ไม่ทราบ':money(selected.basePriceSatang)}</dd></div></dl>
        <p className="break-all text-xs text-slate-500">รหัสสัญญา {selected.id}</p>{selected.endedDate&&<p>สิ้นสุดจริง: {displayTransferDate(selected.endedDate)}</p>}{selected.convertedSaleId&&!locked&&<Link href={`/sales-crm/post-booking?saleId=${selected.convertedSaleId}`} prefetch={false} className="text-blue-700 underline">ดำเนินงานหลังจองของการซื้อครั้งนี้</Link>}{selected.programType==='program_c'&&<p className="text-sm text-amber-800">สิทธิ์ส่วนลด C พิจารณาจากวันโอนจริง วันที่เปลี่ยนเป็นซื้อยังไม่ยืนยันสิทธิ์ส่วนลด</p>}
      </section>}
      {command&&actions.includes(command)&&<CanonicalRentalForm key={`${key}:${command}`} snapshot={snapshot} command={command} disabled={locked} onSubmit={input=>void save(input)} onClose={()=>setCommand(null)}/>}
      <section aria-label="รายการสัญญาเช่า" className="space-y-3 rounded-xl border bg-white p-5"><h2 className="text-lg font-bold">สัญญาทุกรอบ</h2><p className="text-sm">หน้า {scope.contractPage+1} · ไม่เกิน 50 รายการต่อหน้า</p>{!snapshot.contracts.length&&<p>ไม่มีสัญญาในหน้านี้</p>}{snapshot.contracts.map(item=><article key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"><div><h3 className="font-bold">แปลง {item.plotId} · โปรแกรม {rentalProgramLabels[item.programType]} · {statusLabels[item.status]}</h3><p>{displayTransferDate(item.startDate)} – {displayTransferDate(item.endDate)}</p><p className="break-all text-xs">{item.id}</p></div><button className={bookingButtonClass} disabled={locked||item.id===scope.contractId} onClick={()=>navigate({contractId:item.id,eventPage:0,paymentPage:0})}>เปิดสัญญา {item.plotId}</button></article>)}{paging('contractPage',snapshot.contractsHasMore,'สัญญา')}</section>
      {selected&&<>
        <section aria-label="ประวัติเงินรับ" className="space-y-3 rounded-xl border bg-white p-5"><h2 className="text-lg font-bold">เงินรับจริงพร้อมหลักฐาน</h2><p className="text-sm">หน้า {scope.paymentPage+1} · ไม่เกิน 50 รายการต่อหน้า · ไม่มีการแก้ไขหรือลบประวัติ</p>{!snapshot.payments.length&&<p>ไม่มีเงินรับในหน้านี้</p>}{snapshot.payments.map(item=><article key={item.id} className="space-y-2 rounded-lg border p-4"><h3 className="font-bold">{rentalPaymentLabels[item.kind]} · {money(item.amountSatang)}</h3><p>วันรับเงิน {displayTransferDate(item.paidDate)} · อ้างอิง {item.reference}</p><p>หลักฐานที่ผู้บันทึกระบุ: {item.evidenceNote}</p><p className="text-sm">บันทึกเข้าระบบ {displayBangkokTime(item.recordedAt)}</p></article>)}{paging('paymentPage',snapshot.paymentsHasMore,'เงินรับ')}</section>
        <section aria-label="ประวัติสัญญา" className="space-y-3 rounded-xl border bg-white p-5"><h2 className="text-lg font-bold">เหตุการณ์สัญญา</h2><p className="text-sm">หน้า {scope.eventPage+1} · ไม่เกิน 50 รายการต่อหน้า</p>{!snapshot.events.length&&<p>ไม่มีเหตุการณ์ในหน้านี้</p>}{snapshot.events.map(item=><article key={item.id} className="space-y-2 rounded-lg border p-4"><h3 className="font-bold">{rentalCommandLabels[item.command]}</h3><p>วันเกิดเหตุการณ์ {rentalDate(item.occurredDate)} · บันทึก {displayBangkokTime(item.recordedAt)}</p><p>เหตุผล: {item.reason}</p><p className="break-all text-xs">ผู้บันทึก {item.actorUserId}</p></article>)}{paging('eventPage',snapshot.eventsHasMore,'เหตุการณ์')}</section>
      </>}
      {canStart&&<section aria-label="รายการแปลงว่าง" className="space-y-3 rounded-xl border bg-white p-5"><h2 className="font-bold">เลือกแปลงว่างเพื่อเริ่มสัญญา</h2><p className="text-sm">หน้า {scope.plotPage+1} · เลือกได้เฉพาะแปลงว่างที่แสดงในหน้านี้ · ไม่เกิน 50 รายการต่อหน้า</p>{paging('plotPage',snapshot.plotsHasMore,'แปลง')}</section>}
    </>}
  </main>;
}

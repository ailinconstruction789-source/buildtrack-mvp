'use client';

import { useState } from 'react';
import { bahtToSatang } from '@/lib/sales/bookingContracts';
import { parseRentalCommandInput, type RentalCommandInput, type RentalCommandSnapshot, type RentalProgram, type RentalPaymentKind } from '@/lib/sales/rentalCommandContracts';
import { bookingButtonClass, bookingFieldClass } from './BookingForm';

export const rentalCommandLabels: Record<RentalCommandInput['command'], string> = { start: 'เริ่มสัญญาเช่า', renew: 'ต่อสัญญา', record_payment: 'บันทึกเงินรับจริง', end: 'สิ้นสุดสัญญา', convert_to_buy: 'เปลี่ยนเป็นซื้อ' };
export const rentalProgramLabels: Record<RentalProgram,string> = { program_a: 'A', program_b: 'B', program_c: 'C' };
export const rentalPaymentLabels: Record<RentalPaymentKind,string> = { rent: 'ค่าเช่า', savings: 'เงินออม', security_deposit: 'เงินประกัน', advance_rent: 'ค่าเช่าล่วงหน้า' };
interface Props { snapshot: RentalCommandSnapshot; command: RentalCommandInput['command']; disabled: boolean; onSubmit: (input: RentalCommandInput) => void; onClose: () => void }

export default function CanonicalRentalForm({ snapshot, command, disabled, onSubmit, onClose }: Props) {
  const [reason,setReason]=useState(''), [date,setDate]=useState(''), [error,setError]=useState('');
  const [program,setProgram]=useState<RentalProgram>('program_a'), [plotId,setPlotId]=useState(''), [months,setMonths]=useState('12');
  const [rent,setRent]=useState(''), [security,setSecurity]=useState(''), [advance,setAdvance]=useState(''), [savings,setSavings]=useState(''), [basePrice,setBasePrice]=useState('');
  const [kind,setKind]=useState<RentalPaymentKind>('rent'), [amount,setAmount]=useState(''), [reference,setReference]=useState(''), [evidence,setEvidence]=useState('');
  const [price,setPrice]=useState(''), [discount,setDiscount]=useState(''), [deposit,setDeposit]=useState('');
  const [method,setMethod]=useState(''), [route,setRoute]=useState(''), [visitId,setVisitId]=useState('');
  const contract=snapshot.selectedContract;
  const allowed=snapshot.interest.canEdit && snapshot.actor.role!=='owner' && (snapshot.actor.role==='admin' || snapshot.actor.userId===snapshot.interest.ownerUserId)
    && (command==='start' ? !snapshot.contracts.some(item=>['active','renewed'].includes(item.status)) && !contract : !!contract && ['active','renewed'].includes(contract.status));
  const input=(label:string,value:string,set:(v:string)=>void, type='text')=><label className="block">{label}<input className={bookingFieldClass} type={type} inputMode={type==='text'?'decimal':undefined} value={value} onChange={event=>set(event.target.value)} /></label>;
  return <form aria-label="บันทึกสัญญาเช่า" className="space-y-4 rounded-xl border border-blue-200 bg-white p-5" onSubmit={event=>{
    event.preventDefault(); if(disabled || !allowed) return;
    try {
      const common={ requestId:crypto.randomUUID(), command, customerId:snapshot.customer.id, interestId:snapshot.interest.id, projectName:snapshot.interest.projectName,
        expectedCustomerRevision:snapshot.customer.revision, expectedInterestRevision:snapshot.interest.revision,
        contractId: command==='start'?null:contract!.id, expectedContractRevision:command==='start'?null:contract!.revision, reason };
      let details:Record<string,unknown>;
      if(command==='start') {
        if(!snapshot.plots.some(item=>item.id===plotId && item.available)) throw new Error('กรุณาเลือกแปลงว่างจากรายการหน้านี้');
        if(!/^\d+$/.test(months)) throw new Error('กรุณาระบุจำนวนเดือนเต็ม');
        details={plotId,programType:program,startDate:date,durationMonths:Number(months),monthlyRentSatang:bahtToSatang(rent),securityDepositSatang:bahtToSatang(security),advanceRentSatang:bahtToSatang(advance),
          savingsPerMonthSatang:program==='program_b'?bahtToSatang(savings):0,basePriceSatang:basePrice.trim()?bahtToSatang(basePrice):null};
      } else if(command==='renew') {
        if(!/^\d+$/.test(months)) throw new Error('กรุณาระบุจำนวนเดือนเต็ม');
        details={renewalMonths:Number(months),monthlyRentSatang:bahtToSatang(rent)};
      } else if(command==='record_payment') details={kind,amountSatang:bahtToSatang(amount),paidDate:date,reference,evidenceNote:evidence};
      else if(command==='end') details={endDate:date};
      else details={purchaseDate:date,paymentMethod:method,listPriceSatang:bahtToSatang(price),discountSatang:bahtToSatang(discount),depositSatang:bahtToSatang(deposit),bookingRoute:route,visitId:route==='visited'?visitId:null};
      const parsed=parseRentalCommandInput({...common,...details}); setError(''); onSubmit(parsed);
    } catch(failure){setError(failure instanceof Error?failure.message:'กรุณาตรวจข้อมูล');}
  }}>
    <h2 className="text-lg font-bold">{rentalCommandLabels[command]}</h2>
    <p className="text-sm text-slate-600">{snapshot.customer.name} · {snapshot.interest.projectName}{contract?` · แปลง ${contract.plotId}`:''}</p>
    {error && <p role="alert" className="text-rose-700">{error}</p>}
    <fieldset disabled={disabled || !allowed} className="space-y-4">
      {command==='start' && <>
        <label className="block">แปลงว่าง *<select className={bookingFieldClass} value={plotId} onChange={event=>setPlotId(event.target.value)}><option value="">เลือกแปลง</option>{snapshot.plots.filter(item=>item.available).map(item=><option key={item.id} value={item.id}>{item.name??item.id}</option>)}</select></label>
        <label className="block">โปรแกรมเช่า *<select className={bookingFieldClass} value={program} onChange={event=>setProgram(event.target.value as RentalProgram)}>{Object.entries(rentalProgramLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        {input('วันเริ่มสัญญาจริง *',date,setDate,'date')}
        {input('ระยะเวลาสัญญา (เดือน) *',months,setMonths)}
        {input('ค่าเช่าต่อเดือน (บาท) *',rent,setRent)}
        {input('เงินประกันตามสัญญา (บาท) *',security,setSecurity)}
        {input('ค่าเช่าล่วงหน้าตามสัญญา (บาท) *',advance,setAdvance)}
        {program==='program_b' && input('เงินออมต่อเดือนตามสัญญา (บาท) *',savings,setSavings)}
        {input(program==='program_c'?'ราคาฐานตามสัญญา C (บาท) *':'ราคาฐานตามสัญญา (บาท ถ้ามี)',basePrice,setBasePrice)}
        <p className="text-sm text-amber-800">ยอดตามสัญญายังไม่ใช่เงินรับจริง ต้องบันทึกรับเงินพร้อมหลักฐานแยกต่างหาก ระบุ 0 เมื่อสัญญาไม่มีเงินประกันหรือค่าเช่าล่วงหน้า</p>
      </>}
      {command==='renew' && <>{input('ต่อสัญญา (เดือน) *',months,setMonths)}{input('ค่าเช่าต่อเดือนใหม่ (บาท) *',rent,setRent)}<p className="text-sm">ต่อระยะเวลาจากวันสิ้นสุดสัญญาเดิม เก็บประวัติรอบเดิมไว้</p></>}
      {command==='record_payment' && <>
        <label className="block">ประเภทเงินรับ *<select className={bookingFieldClass} value={kind} onChange={event=>setKind(event.target.value as RentalPaymentKind)}>{Object.entries(rentalPaymentLabels).filter(([value])=>value!=='savings'||contract?.programType==='program_b').map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        {input('จำนวนเงินรับจริง (บาท) *',amount,setAmount)}{input('วันรับเงินจริง *',date,setDate,'date')}
        <label className="block">เลขอ้างอิงรับเงิน *<input className={bookingFieldClass} maxLength={200} value={reference} onChange={event=>setReference(event.target.value)} /></label>
        <label className="block">รายละเอียดหลักฐานรับเงิน *<input className={bookingFieldClass} maxLength={1000} value={evidence} onChange={event=>setEvidence(event.target.value)} /></label>
        <p className="text-sm text-amber-800">บันทึกประวัติรับเงินถาวร ไม่ใช่การออกใบเสร็จหรือการตรวจยืนยันเอกสารกับธนาคาร และไม่มีปุ่มแก้ไขหรือลบรายการนี้</p>
      </>}
      {command==='end' && <>{input('วันสิ้นสุดจริง *',date,setDate,'date')}<p className="text-sm text-amber-800">ยืนยันสิ้นสุดสัญญาเท่านั้น การคืนเงินประกันและการชำระบัญชีต้องดำเนินการแยก ยังไม่มีการคืนเงินอัตโนมัติ</p></>}
      {command==='convert_to_buy' && <>
        {input('วันที่ตกลงซื้อจริง *',date,setDate,'date')}{input('ราคาก่อนส่วนลด (บาท) *',price,setPrice)}{input('ส่วนลดที่ตกลง (บาท) *',discount,setDiscount)}{input('เงินจองรับจริง (บาท) *',deposit,setDeposit)}
        <label className="block">วิธีชำระ *<select className={bookingFieldClass} value={method} onChange={event=>setMethod(event.target.value)}><option value="">เลือกวิธีชำระ</option><option value="cash">เงินสด</option><option value="mortgage">กู้ธนาคาร</option></select></label>
        <label className="block">เส้นทางจอง *<select className={bookingFieldClass} value={route} onChange={event=>setRoute(event.target.value)}><option value="">เลือกเส้นทาง</option><option value="visited">ผ่านการเยี่ยมชม</option><option value="without_visit">จองโดยไม่มีการเยี่ยมชม</option></select></label>
        {route==='visited' && <label className="block">รหัสเยี่ยมชมจริง *<input className={bookingFieldClass} value={visitId} onChange={event=>setVisitId(event.target.value)} /></label>}
        <p className="text-sm text-amber-800">เงินออมและเงินประกันที่เคยรับยังไม่ถูกนำมาเป็นเงินจองหรือส่วนลดอัตโนมัติ การจัดสรรหรือคืนเงินต้องตรวจและดำเนินการแยก</p>
        {contract?.programType==='program_c' && <p className="text-sm text-amber-800">สิทธิ์ส่วนลดโปรแกรม C ต้องพิจารณาจากวันโอนจริงตามเงื่อนไขสัญญา วันที่ตกลงซื้อยังไม่ยืนยันสิทธิ์ส่วนลด</p>}
      </>}
      <label className="block">เหตุผล *<input className={bookingFieldClass} maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)} /></label>
      <div className="flex flex-wrap gap-3"><button type="submit" className={bookingButtonClass}>ยืนยัน{rentalCommandLabels[command]}</button><button type="button" className={bookingButtonClass} onClick={()=>{if(!disabled && allowed) onClose();}}>ปิดแบบฟอร์ม</button></div>
    </fieldset>
  </form>;
}

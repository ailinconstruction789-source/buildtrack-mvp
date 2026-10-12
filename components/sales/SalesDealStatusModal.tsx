'use client';

import { useEffect, useRef, useState, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase';
import { canEditSalesRole, getLeadStage } from '@/lib/sales/leadStage';
import { customerDealDetails, customerDealSummary } from '@/lib/sales/customerDealDetails';
import SalesOverlay from './SalesOverlay';
import PostBookingLink from './PostBookingLink';
import { crmSaleCustomer } from '@/lib/sales/saleCustomer';
import { customerDealReadApi } from '@/lib/sales/customerDealReadClient';
import type { CustomerHistoryDate } from '@/lib/sales/customerHistory';
import CustomerHistoryTimeline from './CustomerHistoryTimeline';
import { bangkokToday } from '@/lib/sales/actionFilters';
import { SALES_BANK_NAMES, CASH_BANK_OPTION } from '@/lib/sales/banks';
import { salesDealStages as stages, salesDealNextStages, salesDealPaymentMethodOf, salesDealLeadStatus, salesDealContractStatus, salesDealTransitionError, salesDealStageOf as stageOf } from '@/lib/sales/dealStatus';
const CustomerDealDetailsEditor = dynamic(() => import('./CustomerDealDetailsEditor'), {
  loading: () => <p role="status">กำลังเปิดฟอร์มแก้ข้อมูล…</p>,
});

interface Props {
  lead: Record<string, unknown>;
  currentUser?: { id?: string; role?: string; username?: string; displayName?: string } | null;
  onClose: () => void;
  onSaved: (notice: string) => void;
  renderEditor?: (editor: SalesDealEditorModel) => ReactNode;
}
type Row = Record<string, unknown>;
export interface SalesDealDraft { name: string; phone: string; occupation: string; price: string; bank: string; method: 'cash' | 'mortgage'; agentName?: string; landOfficePrice?: string }
type Draft = SalesDealDraft;
export interface SalesDealEditorModel {
  draft: Draft; setDraft: Dispatch<SetStateAction<Draft>>;
  initial: string; target: string; setTarget: Dispatch<SetStateAction<string>>;
  note: string; setNote: Dispatch<SetStateAction<string>>;
  reason: string; setReason: Dispatch<SetStateAction<string>>;
  eventDate: string; setEventDate: Dispatch<SetStateAction<string>>;
  choices: string[]; busy: boolean; loading: boolean; locked: boolean; editable: boolean; canSave: boolean;
  error: string; resolved: { leadId: string | null; saleId: string | null } | null;
  save: (options?: { confirmedBySubmit?: boolean }) => Promise<void>;
}
const leadColumns = 'id,customer_name,phone,occupation,agent_name,status,crm_status,notes,updated_at';
const saleColumns = 'id,lead_id,crm_stage,contract_status,sale_price,land_office_price,bank_name,payment_method,project_interest_id,external_booking_id,updated_at';
const str = (value: unknown) => value == null ? '' : String(value);
function draftOf(lead: Row | null, sale: Row | null): Draft {
  const details = customerDealDetails(lead?.notes);
  const crm = sale ? crmSaleCustomer(sale) : null;
  return { name: str(lead?.customer_name ?? crm?.name), phone: str(lead?.phone ?? crm?.phone), occupation: str(lead?.occupation),
    price: str(sale?.sale_price ?? details.salePrice), bank: sale ? str(sale.bank_name) : details.bank, method: salesDealPaymentMethodOf(sale || { notes: lead?.notes, bank_name: details.bank }),
    agentName: str(lead?.agent_name), landOfficePrice: str(sale?.land_office_price) };
}

/** Lead and native Project Map share all post-booking progress and confirmation rules. */
export default function SalesDealStatusModal(props: Props) {
  const { lead, currentUser } = props;
  return <DealEditor key={JSON.stringify([lead.leadId, lead.saleId, currentUser?.id || currentUser?.username, currentUser?.role])} {...props} />;
}
function DealEditor({ lead, currentUser, onClose, onSaved, renderEditor }: Props) {
  const [initial, setInitial] = useState(stageOf(lead));
  const [target, setTarget] = useState(stageOf(lead));
  const [draft, setDraft] = useState<Draft>(() => draftOf(lead, null));
  const [baseline, setBaseline] = useState<Draft | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [eventDate, setEventDate] = useState(() => bangkokToday(new Date()));
  const [confirmed, setConfirmed] = useState(false);
  const [cancelCategory, setCancelCategory] = useState('booking_cancelled');
  const [busy, setBusy] = useState(false);
  const [editingCrmDetails, setEditingCrmDetails] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [protectedSale, setProtectedSale] = useState<{ id: string; stage: string; details: Draft; method: unknown; history?: CustomerHistoryDate[]; editingAvailable?: boolean } | null>(null);
  const [resolved, setResolved] = useState<{ leadId: string | null; saleId: string | null } | null>(null);
  const progress = useRef<{ lead: boolean; sale: boolean; history: boolean; payload: { target: string; note: string; draft: Draft; reason: string; eventDate: string; confirmed: boolean; cancelCategory: string; occurredAt: string } | null }>({ lead: false, sale: false, history: false, payload: null });
  const leadInitial = useRef<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const leadId = typeof lead.leadId === 'string' && lead.leadId ? lead.leadId : null;
  const suppliedSaleId = typeof lead.saleId === 'string' && lead.saleId ? lead.saleId : null;
  const projectName = str(lead.project_name || lead.projectName || lead.interest);
  const actorId = str(currentUser?.id);
  const terminal = !['booked', 'transferred'].includes(getLeadStage(lead)) || initial === 'handover';
  const editable = canEditSalesRole(currentUser?.role) && !terminal && Boolean(leadId || suppliedSaleId);
  useEffect(() => {
    setLoading(true); setResolved(null); setProtectedSale(null); setError('');
    if (!editable && !suppliedSaleId) { setLoading(false); return; }
    let cancelled = false;
    const controller = new AbortController();
    async function load() {
      try {
        let currentLead: Row | null = null, currentSale: Row | null = null;
        if (leadId) {
          const result = await supabase.from('leads').select(leadColumns).eq('id', leadId).single();
          if (result.error) throw result.error;
          currentLead = result.data;
          if (!currentLead || currentLead.id !== leadId || !['booked', 'transferred'].includes(getLeadStage(currentLead))) throw new Error('สถานะลูกค้าเปลี่ยนแล้ว กรุณาปิดและโหลดข้อมูลล่าสุด');
        }
        if (cancelled) return;
        if (suppliedSaleId) {
          const result = await supabase.from('sales').select(saleColumns).eq('id', suppliedSaleId).single();
          if (result.error) throw result.error;
          currentSale = result.data;
          if (!currentSale || currentSale.id !== suppliedSaleId) throw new Error('ไม่พบรายการขาย');
        } else if (leadId) {
          // Resolve by relationship only, never by customer name or a plot alias.
          const result = await supabase.from('sales').select(saleColumns).eq('lead_id', leadId).neq('contract_status', 'Cancelled').limit(2);
          if (result.error) throw result.error;
          if ((result.data?.length || 0) > 1) throw new Error('พบหลายรายการขาย กรุณาเลือกรายการที่ต้องการจาก Project Map');
          currentSale = result.data?.[0] || null;
        }
        if (cancelled) return;
        if (currentSale && (currentSale.project_interest_id || currentSale.external_booking_id)) {
          setProtectedSale({ id: str(currentSale.id), stage: stageOf(currentSale),
            details: draftOf(currentSale.lead_id === leadId ? currentLead : null, currentSale), method: currentSale.payment_method });
          try {
            const context = await customerDealReadApi.read({ saleId: str(currentSale.id), projectName }, { signal: controller.signal });
            if (cancelled) return;
            setProtectedSale({ id: context.deal.id, stage: context.deal.stage, method: context.deal.paymentMethod,
              details: { name: context.customer.name, phone: context.customer.phone || '', occupation: '',
                price: str(context.deal.salePrice), bank: context.deal.bankName || '', method: context.deal.paymentMethod || 'mortgage' }, history: context.history, editingAvailable: context.detailsEditingAvailable });
          } catch {
            if (!cancelled) setError('อ่านสถานะดีลได้ แต่ข้อมูลลูกค้าและประวัติ CRM ยังโหลดไม่ได้ กรุณาลองเปิดใหม่ ลูกค้าเก่าไม่ต้องสร้าง Lead ย้อนหลัง');
          }
          return;
        }
        if (currentSale && (!['booked', 'transferred'].includes(getLeadStage({ status: currentSale.contract_status }))
          || (leadId && currentSale.lead_id !== leadId))) throw new Error('รายการขายไม่ตรงกับลูกค้าหรือสถานะล่าสุด กรุณาโหลดใหม่');
        const stage = stageOf(currentSale || currentLead || lead);
        leadInitial.current = currentLead ? stageOf(currentLead) : null;
        const values = draftOf(currentLead, currentSale);
        setDraft(values); setBaseline(values); setInitial(stage); setTarget(stage); setCancelCategory(stage === 'loan_rejected' ? 'final_loan_rejection' : stage === 'downpayment' ? 'downpayment_abandoned' : 'booking_cancelled');
        setResolved({ leadId, saleId: currentSale ? str(currentSale.id) : null });
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : (failure as { message?: string })?.message || 'โหลดข้อมูลล่าสุดไม่สำเร็จ');
      } finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; controller.abort(); };
  }, [editable, leadId, suppliedSaleId, projectName, actorId]);
  const choices = [initial, ...salesDealNextStages(initial, draft.method)];
  const lifecycle = target !== initial && ['transferred', 'handover', 'cancelled'].includes(target);
  const reasonRequired = target !== initial && ['loan_rejected', 'cancelled'].includes(target);
  const changed = Boolean(baseline && (target !== initial || note.trim() || Object.keys(draft).some(key => draft[key as keyof Draft] !== baseline[key as keyof Draft])));
  async function save(options?: { confirmedBySubmit?: boolean }) {
    if (!editable || !resolved || !baseline || inFlight.current || !choices.includes(target) || (!changed && !progress.current.payload)) return;
    if (resolved.leadId && !draft.name.trim()) { setError('กรุณาระบุชื่อลูกค้า'); return; }
    const price = draft.price.trim() ? Number(draft.price.replace(/,/g, '')) : null;
    if ((price !== null && (!Number.isFinite(price) || price < 0)) || (baseline.price && price === null) || /[\r\n]/.test(draft.bank)) { setError('กรุณาระบุราคาขายเป็นตัวเลขที่ไม่ติดลบ และธนาคารในบรรทัดเดียว'); return; }
    const submittedConfirmation = confirmed || options?.confirmedBySubmit === true;
    const appraisal = draft.landOfficePrice?.trim() ? Number(draft.landOfficePrice.replace(/,/g, '')) : null;
    if (appraisal !== null && (!Number.isFinite(appraisal) || appraisal < 0)) { setError('กรุณาระบุราคาประเมินเป็นตัวเลขที่ไม่ติดลบ'); return; }
    const transitionError = salesDealTransitionError(initial, target, draft.method, { bank: draft.bank, reason, date: eventDate, confirmed: submittedConfirmation, saleId: resolved.saleId });
    if (transitionError) { setError(transitionError); return; }
    inFlight.current = true; setBusy(true); setError('');
    const submitted = progress.current.payload || { target, note: note.trim(), draft: { ...draft }, reason: reason.trim(), eventDate, confirmed: submittedConfirmation, cancelCategory, occurredAt: new Date().toISOString() };
    const option = stages.find(s => s.id === submitted.target)!;
    const stageChanged = submitted.target !== initial;
    progress.current.payload = submitted;
    try {
      let currentLead: Row | null = null, currentSale: Row | null = null;
      if (resolved.leadId && !progress.current.lead) {
        const result = await supabase.from('leads').select(leadColumns).eq('id', resolved.leadId).single();
        if (result.error) throw result.error;
        currentLead = result.data;
        if (!currentLead || currentLead.id !== resolved.leadId || !['booked', 'transferred'].includes(getLeadStage(currentLead)) || stageOf(currentLead) !== leadInitial.current) throw new Error('สถานะลูกค้าเปลี่ยนแล้ว กรุณาปิดและโหลดข้อมูลล่าสุด');
        const latest = draftOf(currentLead, null);
        for (const key of ['name', 'phone', 'occupation', 'agentName'] as const) {
          if (submitted.draft[key] !== baseline[key] && latest[key] !== baseline[key]) throw new Error('ข้อมูลลูกค้าเปลี่ยนแล้ว กรุณาปิดและโหลดข้อมูลล่าสุด');
        }
        if (!resolved.saleId && (latest.price !== baseline.price || latest.bank !== baseline.bank || latest.method !== baseline.method)) throw new Error('ข้อมูลการขายเปลี่ยนแล้ว กรุณาปิดและโหลดข้อมูลล่าสุด');
      }
      if (!mounted.current) return;
      if (resolved.saleId && !progress.current.sale) {
        const result = await supabase.from('sales').select(saleColumns).eq('id', resolved.saleId).single();
        if (result.error) throw result.error;
        currentSale = result.data;
        if (!currentSale || currentSale.project_interest_id || currentSale.external_booking_id || currentSale.id !== resolved.saleId || !['booked', 'transferred'].includes(getLeadStage({ status: currentSale.contract_status })) || stageOf(currentSale) !== initial
          || (resolved.leadId && currentSale.lead_id !== resolved.leadId)) throw new Error('สถานะรายการขายเปลี่ยนแล้ว กรุณาปิดและโหลดข้อมูลล่าสุด');
        const latest = draftOf(null, currentSale);
        if (latest.price !== baseline.price || latest.bank !== baseline.bank || latest.method !== baseline.method || latest.landOfficePrice !== baseline.landOfficePrice) throw new Error('ราคา/ธนาคารเปลี่ยนแล้ว กรุณาปิดและโหลดข้อมูลล่าสุด');
      }
      if (!mounted.current) return;
      if (resolved.saleId && !progress.current.sale) {
        const patch: Row = {};
        if (stageChanged) Object.assign(patch, { crm_stage: submitted.target, contract_status: salesDealContractStatus(submitted.target) });
        if (submitted.draft.method !== baseline.method) patch.payment_method = submitted.draft.method;
        const stamp = ['transferred', 'handover', 'cancelled'].includes(submitted.target) ? new Date(submitted.eventDate + 'T12:00:00+07:00').toISOString() : new Date().toISOString();
        if (stageChanged && submitted.target === 'contracted') patch.contracted_at = stamp;
        if (stageChanged && submitted.target === 'transferred') patch.transferred_at = stamp;
        if (stageChanged && submitted.target === 'handover') patch.crm_handover_at = stamp;
        if (stageChanged && submitted.target === 'cancelled') Object.assign(patch, { cancelled_at: stamp, cancellation_reason: submitted.reason, cancellation_category: submitted.cancelCategory });
        if (submitted.draft.price !== baseline.price) patch.sale_price = submitted.draft.price.trim() ? Number(submitted.draft.price.replace(/,/g, '')) : null;
        if (submitted.draft.landOfficePrice !== baseline.landOfficePrice) patch.land_office_price = submitted.draft.landOfficePrice?.trim() ? Number(submitted.draft.landOfficePrice.replace(/,/g, '')) : null;
        if (submitted.draft.bank !== baseline.bank) patch.bank_name = submitted.draft.bank.trim() || null;
        if (Object.keys(patch).length) {
          let query = supabase.from('sales').update(patch).eq('id', resolved.saleId);
          for (const key of ['crm_stage', 'contract_status', 'updated_at'] as const) query = currentSale?.[key] == null ? query.is(key, null) : query.eq(key, currentSale[key]);
          const { data, error: failure } = await query.select('id').single();
          if (failure) throw failure;
          if (!data?.id) throw new Error('ไม่พบรายการขายที่สามารถอัปเดตได้');
          progress.current.sale = true;
        }
        if (!mounted.current) return;
      }
      if (resolved.leadId && !progress.current.lead) {
        const stamp = new Date().toISOString();
        const dealPrice = submitted.draft.price.trim() ? Number(submitted.draft.price.replace(/,/g, '')) : null;
        const added = `[${stamp} อัปเดตข้อมูลการขาย โดย ${currentUser?.username || currentUser?.displayName || 'ฝ่ายขาย'}] ${option.label}\n${customerDealSummary(dealPrice, submitted.draft.bank)}\n• วิธีชำระเงิน: ${submitted.draft.method === 'cash' ? 'เงินสด' : 'กู้ธนาคาร'}${submitted.reason ? '\n• เหตุผล: ' + submitted.reason : ''}${lifecycle ? '\n• วันที่ทำรายการ: ' + submitted.eventDate : ''}${submitted.note ? '\n' + submitted.note : ''}`;
        const patch: Row = { notes: `${added}\n\n${str(currentLead?.notes)}`, updated_at: stamp };
        if (stageChanged || leadInitial.current !== submitted.target) Object.assign(patch, { status: salesDealLeadStatus(submitted.target), crm_status: option.label });
        if (stageChanged && submitted.target === 'transferred') patch.transferred_date = new Date(submitted.eventDate + 'T12:00:00+07:00').toISOString();
        if (stageChanged && submitted.target === 'cancelled') patch.lost_reason = submitted.reason;
        for (const [key, column] of [['name', 'customer_name'], ['phone', 'phone'], ['occupation', 'occupation'], ['agentName', 'agent_name']] as const) {
          if (submitted.draft[key] !== baseline[key]) patch[column] = submitted.draft[key]?.trim() || null;
        }
        let query = supabase.from('leads').update(patch).eq('id', resolved.leadId);
        query = currentLead?.updated_at == null ? query.is('updated_at', null) : query.eq('updated_at', currentLead.updated_at);
        const { data, error: failure } = await query.select('id').single();
        if (failure) throw failure;
        if (!data?.id) throw new Error('ไม่พบลูกค้าที่สามารถอัปเดตได้');
        progress.current.lead = true;
      }
      if (!mounted.current) return;
      if (!progress.current.history && (stageChanged || (!resolved.leadId && submitted.note))) {
        const detail = [submitted.reason, submitted.note, submitted.draft.bank ? `ธนาคาร: ${submitted.draft.bank}` : '', `วิธีชำระเงิน: ${submitted.draft.method === 'cash' ? 'เงินสด' : 'กู้ธนาคาร'}`].filter(Boolean).join(' | ');
        const result = await supabase.from('status_history').insert({
          entity_type: resolved.leadId ? 'lead' : 'sale', entity_id: resolved.leadId || resolved.saleId,
          old_status: initial, new_status: submitted.target,
          changed_by: `${currentUser?.username || currentUser?.displayName || 'ฝ่ายขาย'}${detail ? ' (' + detail + ')' : ''}`,
          created_at: lifecycle ? new Date(submitted.eventDate + 'T12:00:00+07:00').toISOString() : submitted.occurredAt,
        }).select('id').single();
        if (result.error) throw result.error;
        if (!result.data?.id) throw new Error('บันทึกประวัติสถานะยังไม่สำเร็จ');
        progress.current.history = true;
      }
      if (mounted.current) onSaved(`อัปเดตข้อมูลลูกค้าและการขายแล้ว${stageChanged ? ` — ${option.label}` : ''}`);
    } catch (failure) {
      if (!mounted.current) return;
      const message = failure instanceof Error ? failure.message : (failure as { message?: string })?.message || 'บันทึกไม่สำเร็จ';
      const partial = progress.current.lead || progress.current.sale || progress.current.history;
      setError(`${partial ? 'บันทึกบางส่วนแล้ว ยังไม่ครบ: ' : ''}${message}${partial ? ' กดลองบันทึกต่อโดยไม่เปลี่ยนข้อมูล' : ''}`);
      if (!partial) progress.current.payload = null;
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  const locked = busy || loading || !resolved || Boolean(progress.current.payload);
  const field = (key: keyof Draft, label: string, disabled = false) => <label className="block text-sm font-semibold">{label}<input aria-label={label} value={draft[key]} disabled={locked || disabled} onChange={e => setDraft({ ...draft, [key]: e.target.value })} className="block w-full border rounded-xl p-2 mt-1 disabled:bg-slate-50" /></label>;
  if (renderEditor) return renderEditor({ draft: protectedSale ? { ...draft, ...protectedSale.details } : draft, setDraft,
    initial: protectedSale?.stage || initial, target: protectedSale?.stage || target, setTarget,
    note, setNote, reason, setReason, eventDate, setEventDate, choices: protectedSale ? [protectedSale.stage] : choices,
    busy, loading, locked: locked || !editable || Boolean(protectedSale), editable: editable && !protectedSale,
    error, resolved, canSave: editable && !protectedSale && !busy && !loading && Boolean(resolved) && (changed || Boolean(progress.current.payload)), save });
  return <SalesOverlay role="dialog" aria-modal="true" aria-label="สถานะหลังจอง" className="fixed inset-0 z-[300] bg-slate-950/70 flex items-center justify-center p-4">
    <div className="bg-white rounded-2xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto">
      <div className="flex justify-between gap-3"><h2 className="font-bold">{editable && !protectedSale ? 'อัปเดตข้อมูลลูกค้าและการขาย' : 'รายละเอียดสถานะลูกค้า'}</h2><button type="button" disabled={busy} onClick={onClose} className="text-sm font-bold">ปิด</button></div>
      <p className="text-sm">{str(lead.customer_name || lead.name)} · {str(lead.project_name || lead.interest)}</p>
      <p className="text-xs text-slate-600">แปลง: {str(lead.interested_plot_name || lead.interested_plot_id || lead.plotName || lead.plot || 'ยังไม่ระบุ')}</p>
      {loading && <p role="status">กำลังโหลดข้อมูลล่าสุด…</p>}
      {protectedSale ? <section aria-label="รายละเอียดรายการขาย CRM" className="space-y-3">
        <p className="text-sm text-amber-900">{protectedSale.editingAvailable
          ? 'ข้อมูลต้นทางของ CRM ยังคงเดิม การแก้ข้อมูลปัจจุบันใช้คำสั่งเซิร์ฟเวอร์ที่ตรวจสิทธิ์และบันทึกประวัติ'
          : 'รายการขายนี้อยู่ใน CRM ที่ป้องกันการเขียนโดยตรง ข้อมูลด้านล่างอ่านได้อย่างเดียว งานหลังจองต้องใช้คำสั่งฝั่งเซิร์ฟเวอร์ที่ได้รับอนุญาต'}</p>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div><dt className="font-semibold">ชื่อลูกค้า</dt><dd>{protectedSale.details.name || 'ยังไม่ระบุ'}</dd></div>
          <div><dt className="font-semibold">เบอร์โทรศัพท์</dt><dd>{protectedSale.details.phone || 'ยังไม่ระบุ'}</dd></div>
          <div><dt className="font-semibold">สถานะปัจจุบัน</dt><dd>{stages.find(stage => stage.id === protectedSale.stage)?.label || protectedSale.stage}</dd></div>
          <div><dt className="font-semibold">ราคาขายสุทธิ</dt><dd>{protectedSale.details.price === '' ? 'ยังไม่ระบุ' : Number(protectedSale.details.price).toLocaleString('th-TH') + ' บาท'}</dd></div>
          <div><dt className="font-semibold">ธนาคาร</dt><dd>{protectedSale.details.bank || 'ยังไม่ระบุ'}</dd></div>
          <div><dt className="font-semibold">วิธีชำระเงิน</dt><dd>{protectedSale.method === 'cash' ? 'เงินสด' : protectedSale.method === 'mortgage' ? 'กู้ธนาคาร' : 'ยังไม่มีหลักฐานวิธีชำระเงิน'}</dd></div>
        </dl>
        {protectedSale.history && <CustomerHistoryTimeline history={protectedSale.history} />}
        <p className="text-xs text-slate-500">ลูกค้าเก่าเก็บประวัติจากดีลเดิมได้ แม้ไม่มี Lead หรือวันที่บางขั้นตอน</p>
        {editingCrmDetails ? <>
          <CustomerDealDetailsEditor saleId={protectedSale.id} projectName={projectName} currentUserId={actorId}
            onBusyChange={setBusy} onSaved={() => onSaved('อัปเดตข้อมูลลูกค้าและดีล CRM แล้ว')} />
          <button type="button" disabled={busy} onClick={() => setEditingCrmDetails(false)} className="text-sm font-semibold disabled:opacity-50">ปิดการแก้ข้อมูล</button>
        </> : <>
          {protectedSale.editingAvailable === true && canEditSalesRole(currentUser?.role) && <button type="button" disabled={loading || busy || !projectName || !actorId}
            onClick={() => setEditingCrmDetails(true)} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold disabled:opacity-50">แก้ข้อมูลลูกค้า ราคา และธนาคาร</button>}
          <PostBookingLink saleId={protectedSale.id} label="เปิดประวัติและงานหลังจอง →" />
        </>}
      </section> : editable ? <>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{field('name', 'ชื่อลูกค้า', !resolved?.leadId)}{field('phone', 'เบอร์โทรศัพท์', !resolved?.leadId)}{field('occupation', 'อาชีพ', !resolved?.leadId)}{field('price', 'ราคาขายสุทธิ')}<label className="block text-sm font-semibold">ธนาคาร / วิธีชำระเงิน<select aria-label="ธนาคาร" value={draft.bank} disabled={locked} onChange={e => { setDraft({ ...draft, bank: e.target.value, method: e.target.value === CASH_BANK_OPTION ? 'cash' : 'mortgage' }); setTarget(initial); setConfirmed(false); }} className="block w-full border rounded-xl p-2 mt-1 disabled:bg-slate-50">
          <option value="">-- เลือกธนาคาร/เงินสด --</option>
          {SALES_BANK_NAMES.map(bank => <option key={bank} value={bank}>{bank}</option>)}
          <option value={CASH_BANK_OPTION}>💵 ซื้อเงินสด</option>
          {baseline?.bank && !SALES_BANK_NAMES.includes(baseline.bank) && baseline.bank !== CASH_BANK_OPTION && <option value={baseline.bank}>{baseline.bank}</option>}
        </select></label>
        <label className="block text-sm font-semibold">วิธีชำระเงิน<select aria-label="วิธีชำระเงิน" value={draft.method} disabled={locked} onChange={e => { const method = e.target.value as Draft['method']; setDraft({ ...draft, method, bank: method === 'cash' ? CASH_BANK_OPTION : draft.bank === CASH_BANK_OPTION ? '' : draft.bank }); setTarget(initial); setConfirmed(false); }} className="block w-full border rounded-xl p-2 mt-1"><option value="mortgage">กู้ธนาคาร</option><option value="cash">เงินสด</option></select></label></div>
        {!loading && resolved && !resolved.leadId && <p className="text-xs text-slate-600">รายการนี้ยังไม่เชื่อมกับ Lead จึงแก้ชื่อและเบอร์โทรจากหน้าจัดการลูกค้าเดิม หมายเหตุที่กรอกจะอยู่ในประวัติสถานะรายการขาย</p>}
        <label className="block text-sm font-semibold">สถานะหลังจอง<select aria-label="สถานะหลังจอง" className="block w-full border rounded-xl p-2 mt-1" value={target} disabled={locked} onChange={e => { setTarget(e.target.value); setConfirmed(false); }}>{choices.map(id => <option key={id} value={id}>{stages.find(s => s.id === id)?.label || id}</option>)}</select></label>
        <label className="block text-sm">หมายเหตุ<textarea aria-label="หมายเหตุสถานะ" value={note} disabled={locked} onChange={e => setNote(e.target.value)} className="block w-full border rounded-xl p-2" /></label>
        {reasonRequired && <label className="block text-sm font-semibold">เหตุผล<textarea aria-label="เหตุผล" value={reason} disabled={locked} onChange={e => { setReason(e.target.value); setConfirmed(false); }} className="block w-full border rounded-xl p-2 mt-1" /></label>}
        {target !== initial && target === 'cancelled' && <label className="block text-sm font-semibold">ประเภทการยกเลิก<select aria-label="ประเภทการยกเลิก" value={cancelCategory} disabled={locked} onChange={e => { setCancelCategory(e.target.value); setConfirmed(false); }} className="block w-full border rounded-xl p-2 mt-1"><option value="booking_cancelled">ยกเลิกจอง</option><option value="downpayment_abandoned">ยุติการผ่อนดาวน์</option><option value="final_loan_rejection">สินเชื่อไม่ผ่านและยุติการซื้อ</option><option value="other">เหตุผลอื่น</option></select></label>}
        {lifecycle && <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <label className="block text-sm font-semibold">วันที่ทำรายการ<input aria-label="วันที่ทำรายการ" type="date" value={eventDate} disabled={locked} onChange={e => { setEventDate(e.target.value); setConfirmed(false); }} className="block w-full border rounded-xl p-2 mt-1" /></label>
          <label className="flex gap-2 text-sm"><input type="checkbox" aria-label="ยืนยันรายการ" checked={confirmed} disabled={locked} onChange={e => setConfirmed(e.target.checked)} />ยืนยัน{stages.find(stage => stage.id === target)?.label} สำหรับลูกค้าและแปลงนี้</label>
          {!resolved?.saleId && <p className="text-sm text-red-700">ยังไม่มีรายการขายที่เชื่อมกับ Lead ต้องตรวจการเชื่อมข้อมูลก่อนบันทึกขั้นตอนนี้</p>}
        </div>}
        <p className="text-xs text-slate-500">แสดงเฉพาะขั้นถัดไปที่ทำได้ เงินสดข้ามสินเชื่อ หลังโอนทำได้เฉพาะส่งมอบ ไม่บันทึกการจองใหม่</p>
      </> : <p className="text-sm text-slate-600">รายการนี้ดูรายละเอียดได้ตามสิทธิ์เดิม รายการส่งมอบแล้วหรือยกเลิกแล้วไม่เปิดแก้ขั้นตอนจากฟอร์มนี้</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {editable && !protectedSale && <button type="button" disabled={busy || loading || !resolved || (!changed && !progress.current.payload)} onClick={() => void save()} className="bg-amber-500 rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-50">{busy ? 'กำลังบันทึก…' : 'บันทึกข้อมูล'}</button>}
    </div>
  </SalesOverlay>;
}

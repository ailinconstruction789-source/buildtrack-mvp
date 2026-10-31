'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase';
import { canEditSalesRole, getLeadStage } from '@/lib/sales/leadStage';
import { customerDealDetails, customerDealSummary, extractAgreedPrices } from '@/lib/sales/customerDealDetails';
import SalesOverlay from './SalesOverlay';
import PostBookingLink from './PostBookingLink';
import { crmSaleCustomer } from '@/lib/sales/saleCustomer';
import { customerDealReadApi } from '@/lib/sales/customerDealReadClient';
import type { CustomerHistoryDate } from '@/lib/sales/customerHistory';
import CustomerHistoryTimeline from './CustomerHistoryTimeline';
import { bangkokToday } from '@/lib/sales/actionFilters';
import { SALES_BANK_NAMES, CASH_BANK_OPTION } from '@/lib/sales/banks';
import { broadcastSalesSync, subscribeToSalesSync } from '@/lib/sales/salesSyncBroadcast';
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
  conflictNotice?: string | null;
  resolveConflict?: () => void;
}
const leadColumns = 'id,customer_name,phone,occupation,agent_name,status,crm_status,notes,project_name,interested_plot_id,interested_plot_name,updated_at';
const saleColumns = 'id,lead_id,plot_id,booking_route,crm_stage,contract_status,sale_price,land_office_price,bank_name,payment_method,project_interest_id,external_booking_id,updated_at';
const str = (value: unknown) => value == null ? '' : String(value);
function draftOf(lead: Row | null, sale: Row | null): Draft {
  const details = customerDealDetails(lead?.notes);
  const agreed = extractAgreedPrices(lead?.notes);
  const crm = sale ? crmSaleCustomer(sale) : null;
  const leadLandPrice = str((lead as any)?.landOfficePrice ?? (lead as any)?.land_office_price);
  const landPrice = str(sale?.land_office_price) || leadLandPrice || (agreed.landAppraisalPrice !== null ? String(agreed.landAppraisalPrice) : '');
  return {
    name: str(lead?.customer_name ?? crm?.name),
    phone: str(lead?.phone ?? crm?.phone),
    occupation: str(lead?.occupation),
    price: str(sale?.sale_price ?? details.salePrice ?? (agreed.salePrice !== null ? agreed.salePrice : '')),
    bank: str(sale?.bank_name) || details.bank,
    method: salesDealPaymentMethodOf(sale?.payment_method ? sale : { notes: lead?.notes, bank_name: str(sale?.bank_name) || details.bank }),
    agentName: str(lead?.agent_name),
    landOfficePrice: landPrice,
  };
}

/** Lead and native Project Map share all post-booking progress and confirmation rules. */
export default function SalesDealStatusModal(props: Props) {
  const { lead, currentUser } = props;
  return <DealEditor key={JSON.stringify([lead.leadId || lead.id, lead.saleId, currentUser?.id || currentUser?.username, currentUser?.role])} {...props} />;
}
function DealEditor({ lead, currentUser, onClose, onSaved, renderEditor }: Props) {
  const [initial, setInitial] = useState(stageOf(lead));
  const [target, setTarget] = useState(stageOf(lead));
  const [draft, setDraftState] = useState<Draft>(() => draftOf(lead, null));
  const [baseline, setBaselineState] = useState<Draft | null>(null);
  const originalBaseline = useRef<Draft | null>(null);
  const serverSnapshot = useRef<{ stage: string; values: Draft; leadStage: string | null } | null>(null);
  const dirtyFieldsRef = useRef<Set<keyof Draft>>(new Set());
  const draftRef = useRef<Draft>(draft);
  draftRef.current = draft;
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [eventDate, setEventDate] = useState(() => bangkokToday(new Date()));
  const [confirmed, setConfirmed] = useState(false);
  const [cancelCategory, setCancelCategory] = useState('booking_cancelled');
  const [busy, setBusy] = useState(false);
  const [editingCrmDetails, setEditingCrmDetails] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [protectedSale, setProtectedSale] = useState<{ id: string; stage: string; details: Draft; method: unknown; history?: CustomerHistoryDate[]; editingAvailable?: boolean } | null>(null);
  const [resolved, setResolved] = useState<{ leadId: string | null; saleId: string | null } | null>(null);
  const progress = useRef<{
    lead: boolean;
    sale: boolean;
    history: boolean;
    payload: { target: string; note: string; draft: Draft; reason: string; eventDate: string; confirmed: boolean; cancelCategory: string; occurredAt: string } | null;
    effectiveValues?: {
      price: number | null;
      bank: string;
      method: string;
      landOfficePrice: number | null;
      serverStage: string;
    } | null;
  }>({ lead: false, sale: false, history: false, payload: null, effectiveValues: null });
  const leadInitial = useRef<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const requestSeq = useRef(0);

  const setDraft = useCallback((nextDraftOrUpdater: any) => {
    setDraftState(prev => {
      const incoming = typeof nextDraftOrUpdater === 'function' ? nextDraftOrUpdater(prev) : nextDraftOrUpdater;
      if (incoming && typeof incoming === 'object') {
        if ('customer_name' in incoming && !('name' in incoming)) (incoming as any).name = (incoming as any).customer_name;
        if ('sale_price' in incoming && !('price' in incoming)) (incoming as any).price = (incoming as any).sale_price;
        if ('bank_name' in incoming && !('bank' in incoming)) (incoming as any).bank = (incoming as any).bank_name;
        if ('payment_method' in incoming && !('method' in incoming)) (incoming as any).method = (incoming as any).payment_method;
      }
      const next = { ...prev, ...incoming };
      draftRef.current = next;
      const base = originalBaseline.current || baseline;
      if (base) {
        for (const key of Object.keys(incoming || {}) as (keyof Draft)[]) {
          if (next[key] !== base[key]) {
            dirtyFieldsRef.current.add(key);
          } else {
            dirtyFieldsRef.current.delete(key);
          }
        }
      }
      return next;
    });
  }, [baseline]);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const leadId = (lead.leadId !== undefined)
    ? (typeof lead.leadId === 'string' && lead.leadId ? lead.leadId : null)
    : (typeof lead.id === 'string' && lead.id && !String(lead.id).startsWith('registry-') ? lead.id : null);
  const suppliedSaleId = typeof lead.saleId === 'string' && lead.saleId ? lead.saleId : null;
  const projectName = str(lead.project_name || lead.projectName || lead.interest);
  const actorId = str(currentUser?.id);
  const terminal = !['booked', 'transferred', 'loan'].includes(getLeadStage(lead)) || initial === 'handover';
  const editable = canEditSalesRole(currentUser?.role) && !terminal && Boolean(leadId || suppliedSaleId);

  // Subscribe to cross-tab / in-window sync events to keep open editor updated
  useEffect(() => {
    const unsub = subscribeToSalesSync(detail => {
      const matchLead = Boolean(detail?.leadId && detail.leadId === leadId);
      const matchSale = Boolean(detail?.saleId && detail.saleId === suppliedSaleId);
      const isGeneral = !detail?.leadId && !detail?.saleId;
      if (isGeneral || matchLead || matchSale) {
        setRefreshTrigger(t => t + 1);
      }
    }, 200);
    return unsub;
  }, [leadId, suppliedSaleId]);

  const changed = Boolean((originalBaseline.current || baseline) && (target !== initial || note.trim() || reason.trim() || dirtyFieldsRef.current.size > 0));
  const isDirtyRef = useRef(changed);
  isDirtyRef.current = changed;
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const targetRef = useRef(target);
  targetRef.current = target;
  const noteRef = useRef(note);
  noteRef.current = note;
  const reasonRef = useRef(reason);
  reasonRef.current = reason;
  const confirmedRef = useRef(confirmed);
  confirmedRef.current = confirmed;

  useEffect(() => {
    const currentReq = ++requestSeq.current;
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
          if (!currentLead || currentLead.id !== leadId || !['booked', 'transferred', 'loan'].includes(getLeadStage(currentLead))) throw new Error('สถานะลูกค้าเปลี่ยนแล้ว กรุณาปิดและโหลดข้อมูลล่าสุด');
        }
        if (cancelled || currentReq !== requestSeq.current) return;
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
          if (!currentSale) {
            const rawPlot = str(
              lead.plot || lead.plotId || lead.plot_id ||
              (Array.isArray(lead.interests) ? (lead.interests[0] as Row)?.plotId : null) ||
              currentLead?.interested_plot_id || currentLead?.interested_plot_name
            );
            const cleanPlot = rawPlot ? rawPlot.replace(/^(AL\d+|YR|K\d+พิเศษ|K\d+|ไอลิน\s*\d+|ไอยริว|กานต์รวี\s*\d+)-?/i, '').trim() : '';
            const candidatePlotName = str(currentLead?.interested_plot_name || lead.plotName || cleanPlot || rawPlot);
            const proj = projectName || str(currentLead?.project_name);
            let plotSaleRes = rawPlot
              ? await supabase.from('sales').select(saleColumns).eq('plot_id', rawPlot).neq('contract_status', 'Cancelled').limit(2)
              : null;
            if (cancelled || currentReq !== requestSeq.current) return;
            if ((!plotSaleRes?.data || plotSaleRes.data.length === 0) && cleanPlot && cleanPlot !== rawPlot) {
              plotSaleRes = await supabase.from('sales').select(saleColumns).eq('plot_id', cleanPlot).neq('contract_status', 'Cancelled').limit(2);
              if (cancelled || currentReq !== requestSeq.current) return;
            }
            if ((!plotSaleRes?.data || plotSaleRes.data.length === 0) && candidatePlotName && proj) {
              const pRes = await supabase.from('plots').select('id').eq('plot_name', candidatePlotName).eq('project_name', proj).maybeSingle();
              if (cancelled || currentReq !== requestSeq.current) return;
              if (pRes?.data?.id && pRes.data.id !== rawPlot && pRes.data.id !== cleanPlot) {
                plotSaleRes = await supabase.from('sales').select(saleColumns).eq('plot_id', pRes.data.id).neq('contract_status', 'Cancelled').limit(2);
                if (cancelled || currentReq !== requestSeq.current) return;
              }
            }
            if (plotSaleRes?.error) throw plotSaleRes.error;
            if ((plotSaleRes?.data?.length || 0) > 1) throw new Error('พบหลายรายการขาย กรุณาเลือกรายการที่ต้องการจาก Project Map');
            if (plotSaleRes?.data?.length === 1) {
              const candidateSale = plotSaleRes.data[0];
              if (!candidateSale.lead_id || candidateSale.lead_id === leadId) {
                currentSale = candidateSale;
              }
            }
          }
        }
        if (cancelled || currentReq !== requestSeq.current) return;
        const isLegacyUnlinkedSale = Boolean(currentSale && !currentSale.lead_id && leadId);
        const isProtected = Boolean(currentSale && !isLegacyUnlinkedSale && currentSale.booking_route !== 'legacy_import' && (currentSale.project_interest_id || currentSale.external_booking_id));
        if (currentSale && isProtected) {
          setProtectedSale({ id: str(currentSale.id), stage: stageOf(currentSale),
            details: draftOf(currentSale.lead_id === leadId ? currentLead : null, currentSale), method: currentSale.payment_method });
          try {
            const context = await customerDealReadApi.read({ saleId: str(currentSale.id), projectName }, { signal: controller.signal });
            if (cancelled || currentReq !== requestSeq.current) return;
            setProtectedSale({ id: context.deal.id, stage: context.deal.stage, method: context.deal.paymentMethod,
              details: { name: context.customer.name, phone: context.customer.phone || '', occupation: '',
                price: str(context.deal.salePrice), bank: context.deal.bankName || '', method: context.deal.paymentMethod || 'mortgage',
                landOfficePrice: str((context.deal as any).landOfficePrice || (context.deal as any).land_office_price || currentSale?.land_office_price || '') }, history: context.history, editingAvailable: context.detailsEditingAvailable });
          } catch {
            if (!cancelled && currentReq === requestSeq.current) setError('อ่านสถานะดีลได้ แต่ข้อมูลลูกค้าและประวัติ CRM ยังโหลดไม่ได้ กรุณาลองเปิดใหม่ ลูกค้าเก่าไม่ต้องสร้าง Lead ย้อนหลัง');
          }
          return;
        }
        if (currentSale && (!['booked', 'transferred', 'loan'].includes(getLeadStage({ status: currentSale.contract_status }))
          || (leadId && currentSale.lead_id && currentSale.lead_id !== leadId))) throw new Error('รายการขายไม่ตรงกับลูกค้าหรือสถานะล่าสุด กรุณาโหลดใหม่');
        const stage = stageOf((isLegacyUnlinkedSale && currentLead) ? currentLead : (currentSale || currentLead || lead));
        const currentLeadStage = currentLead ? stageOf(currentLead) : null;
        leadInitial.current = currentLeadStage;
        const values = draftOf(currentLead, currentSale);
        serverSnapshot.current = { stage, values, leadStage: currentLeadStage };

        const isWorkflowDirty = targetRef.current !== initialRef.current || noteRef.current.trim() !== '' || reasonRef.current.trim() !== '';
        const hasCustomerFieldDraft = dirtyFieldsRef.current.size > 0;
        const hasLocalChanges = Boolean(originalBaseline.current && (hasCustomerFieldDraft || isWorkflowDirty));

        if (!hasLocalChanges) {
          originalBaseline.current = { ...values };
          setBaselineState({ ...values });
          setDraftState({ ...values });
          draftRef.current = { ...values };
          dirtyFieldsRef.current.clear();
          setInitial(stage);
          setTarget(stage);
          setCancelCategory(stage === 'loan_rejected' ? 'final_loan_rejection' : stage === 'downpayment' ? 'downpayment_abandoned' : 'booking_cancelled');
          setConflictNotice(null);
        } else {
          const base = originalBaseline.current || { ...values };
          let fieldConflict: string | null = null;
          const fieldNames: Record<keyof Draft, string> = {
            name: 'ชื่อลูกค้า', phone: 'เบอร์โทรศัพท์', occupation: 'อาชีพ',
            agentName: 'พนักงานขาย', price: 'ราคาขายสุทธิ', bank: 'ธนาคาร',
            method: 'วิธีชำระเงิน', landOfficePrice: 'ราคาประเมิน'
          };

          const curDraft = draftRef.current;
          const mergedDraft = { ...curDraft };
          for (const key of Object.keys(values) as (keyof Draft)[]) {
            if (!dirtyFieldsRef.current.has(key)) {
              (mergedDraft as any)[key] = values[key];
              (base as any)[key] = values[key];
            } else {
              if (values[key] !== base[key]) {
                if (values[key] === curDraft[key]) {
                  (base as any)[key] = values[key];
                  dirtyFieldsRef.current.delete(key);
                } else {
                  if (!fieldConflict) {
                    fieldConflict = `ข้อมูล ${fieldNames[key]} มีการเปลี่ยนแปลงในระบบ (ค่าในระบบ: "${values[key] || 'ว่าง'}") ในระหว่างที่คุณแก้ไข กรุณาตรวจสอบก่อนบันทึก`;
                  }
                }
              }
            }
          }

          draftRef.current = mergedDraft;
          setDraftState(mergedDraft);
          setBaselineState({ ...base });

          if (stage !== initialRef.current) {
            const stageLabel = stages.find(s => s.id === stage)?.label || stage;
            setConflictNotice(`สถานะของลูกค้าในระบบเปลี่ยนเป็น "${stageLabel}" ในระหว่างที่คุณแก้ไข กรุณาตรวจสอบสถานะและเลือกขั้นตอนที่ต้องการดำเนินการต่อ`);
          } else if (fieldConflict) {
            setConflictNotice(fieldConflict);
          } else {
            setConflictNotice(null);
          }
        }
        setResolved({ leadId, saleId: currentSale ? str(currentSale.id) : null });
      } catch (failure) {
        if (!cancelled && currentReq === requestSeq.current) setError(failure instanceof Error ? failure.message : (failure as { message?: string })?.message || 'โหลดข้อมูลล่าสุดไม่สำเร็จ');
      } finally { if (!cancelled && currentReq === requestSeq.current) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; controller.abort(); };
  }, [editable, leadId, suppliedSaleId, projectName, actorId, lead.status, lead.crm_status, lead.crm_stage, (lead as any).updated_at, refreshTrigger]);
  const choices = [initial, ...salesDealNextStages(initial, draft.method)];
  const lifecycle = target !== initial && ['transferred', 'handover', 'cancelled'].includes(target);
  const reasonRequired = target !== initial && ['loan_rejected', 'cancelled'].includes(target);
  async function save(options?: { confirmedBySubmit?: boolean }) {
    if (!editable || !resolved || !baseline || inFlight.current || (!changed && !progress.current.payload)) return;
    if (conflictNotice) { setError("สถานะของลูกค้าในระบบเปลี่ยนไปแล้ว กรุณายอมรับสถานะใหม่หรือตรวจสอบรายการก่อนบันทึก"); return; }
    if (!choices.includes(target)) { setError('ขั้นตอนนี้ไม่ตรงกับสถานะปัจจุบันหรือวิธีชำระเงิน'); return; }
    if (resolved.leadId && !str(draft.name).trim()) { setError('กรุณาระบุชื่อลูกค้า'); return; }
    const price = str(draft.price).trim() ? Number(String(draft.price).replace(/,/g, '')) : null;
    if ((price !== null && (!Number.isFinite(price) || price < 0)) || (baseline.price && price === null) || /[\r\n]/.test(str(draft.bank))) { setError('กรุณาระบุราคาขายเป็นตัวเลขที่ไม่ติดลบ และธนาคารในบรรทัดเดียว'); return; }
    const submittedConfirmation = confirmed || options?.confirmedBySubmit === true;
    const appraisal = str(draft.landOfficePrice).trim() ? Number(String(draft.landOfficePrice).replace(/,/g, '')) : null;
    if (appraisal !== null && (!Number.isFinite(appraisal) || appraisal < 0)) { setError('กรุณาระบุราคาประเมินเป็นตัวเลขที่ไม่ติดลบ'); return; }
    const transitionError = salesDealTransitionError(initial, target, draft.method, { bank: str(draft.bank), reason, date: eventDate, confirmed: submittedConfirmation, saleId: resolved.saleId });
    if (transitionError) { setError(transitionError); return; }
    inFlight.current = true; setBusy(true); setError('');
    const submitted = progress.current.payload || { target, note: note.trim(), draft: { ...draft }, reason: reason.trim(), eventDate, confirmed: submittedConfirmation, cancelCategory, occurredAt: new Date().toISOString() };
    const option = stages.find(s => s.id === submitted.target)!;
    const stageChanged = submitted.target !== initial;
    progress.current.payload = submitted;
    try {
      let currentLead: Row | null = null, currentSale: Row | null = null;
      let isLegacySale = false;
      const assertNoFieldConflict = (keys: readonly (keyof ReturnType<typeof draftOf>)[], latest: ReturnType<typeof draftOf>) => {
        for (const key of keys) {
          if (dirtyFieldsRef.current.has(key) && latest[key] !== originalBaseline.current?.[key] && latest[key] !== submitted.draft[key]) {
            throw new Error('ข้อมูลถูกแก้ไขจากผู้ใช้อื่นในช่องเดียวกัน กรุณาปิดและโหลดข้อมูลล่าสุด');
          }
        }
      };
      if (resolved.leadId && !progress.current.lead) {
        const result = await supabase.from('leads').select(leadColumns).eq('id', resolved.leadId).single();
        if (result.error) throw result.error;
        currentLead = result.data;
        if (!currentLead || currentLead.id !== resolved.leadId || !['booked', 'transferred', 'loan'].includes(getLeadStage(currentLead)) || stageOf(currentLead) !== leadInitial.current) throw new Error('สถานะลูกค้าเปลี่ยนแล้ว กรุณาปิดและโหลดข้อมูลล่าสุด');
        const latest = draftOf(currentLead, null);
        assertNoFieldConflict(resolved.saleId ? ['name', 'phone', 'occupation', 'agentName'] : ['name', 'phone', 'occupation', 'agentName', 'price', 'bank', 'method'], latest);
      }
      if (!mounted.current) return;
      if (resolved.saleId && !progress.current.sale) {
        const result = await supabase.from('sales').select(saleColumns).eq('id', resolved.saleId).single();
        if (result.error) throw result.error;
        currentSale = result.data;
        isLegacySale = Boolean(!currentSale?.lead_id && resolved.leadId);
        const isProtectedSale = Boolean(currentSale && !isLegacySale && currentSale.booking_route !== 'legacy_import' && (currentSale.project_interest_id || currentSale.external_booking_id));
        if (!currentSale || isProtectedSale || currentSale.id !== resolved.saleId || !['booked', 'transferred', 'loan'].includes(getLeadStage({ status: currentSale.contract_status })) || (!isLegacySale && stageOf(currentSale) !== initial)
          || (resolved.leadId && currentSale.lead_id && currentSale.lead_id !== resolved.leadId)) throw new Error('สถานะรายการขายเปลี่ยนแล้ว กรุณาปิดและโหลดข้อมูลล่าสุด');
        assertNoFieldConflict(['price', 'bank', 'method', 'landOfficePrice'], draftOf(currentLead, currentSale));
      }
      if (!mounted.current) return;

      if (!progress.current.effectiveValues) {
        const latest = draftOf(currentLead, currentSale);
        const pick = <K extends keyof typeof latest>(k: K) => dirtyFieldsRef.current.has(k) ? submitted.draft[k] : latest[k];
        const parseNum = (v: string | undefined) => v?.trim() ? Number(v.replace(/,/g, '')) : null;
        progress.current.effectiveValues = {
          price: parseNum(pick('price')),
          bank: pick('bank'),
          method: pick('method'),
          landOfficePrice: parseNum(pick('landOfficePrice')),
          serverStage: stageOf((isLegacySale && currentLead) ? currentLead : (currentSale || currentLead || lead))
        };
      }
      const {
        price: effectivePrice,
        bank: effectiveBank,
        method: effectiveMethod,
        landOfficePrice: effectiveLandOfficePrice,
        serverStage: currentServerStage
      } = progress.current.effectiveValues;

      const effectiveChoices = [currentServerStage, ...salesDealNextStages(currentServerStage, effectiveMethod)];
      if (!effectiveChoices.includes(submitted.target)) {
        throw new Error(`วิธีชำระเงินหรือสถานะในระบบไม่ตรงกับขั้นตอนที่เลือก (${effectiveMethod === 'cash' ? 'เงินสด' : 'กู้ธนาคาร'})`);
      }

      const effectiveTransitionError = salesDealTransitionError(currentServerStage, submitted.target, effectiveMethod, {
        bank: str(effectiveBank),
        reason: submitted.reason,
        date: submitted.eventDate,
        confirmed: submitted.confirmed,
        saleId: resolved.saleId
      });
      if (effectiveTransitionError) {
        throw new Error(effectiveTransitionError);
      }

      if (resolved.saleId && !progress.current.sale) {
        const patch: Row = {};
        if (stageChanged) Object.assign(patch, { crm_stage: submitted.target, contract_status: salesDealContractStatus(submitted.target) });
        if (dirtyFieldsRef.current.has('method') && submitted.draft.method !== originalBaseline.current?.method) patch.payment_method = submitted.draft.method;
        const stamp = ['transferred', 'handover', 'cancelled'].includes(submitted.target) ? new Date(submitted.eventDate + 'T12:00:00+07:00').toISOString() : new Date().toISOString();
        if (stageChanged && submitted.target === 'contracted') patch.contracted_at = stamp;
        if (stageChanged && submitted.target === 'transferred') patch.transferred_at = stamp;
        if (stageChanged && submitted.target === 'handover') patch.crm_handover_at = stamp;
        if (stageChanged && submitted.target === 'cancelled') Object.assign(patch, { cancelled_at: stamp, cancellation_reason: submitted.reason, cancellation_category: submitted.cancelCategory });
        if (dirtyFieldsRef.current.has('price') && submitted.draft.price !== originalBaseline.current?.price) patch.sale_price = submitted.draft.price.trim() ? Number(submitted.draft.price.replace(/,/g, '')) : null;
        if (dirtyFieldsRef.current.has('landOfficePrice') && submitted.draft.landOfficePrice !== originalBaseline.current?.landOfficePrice) patch.land_office_price = submitted.draft.landOfficePrice?.trim() ? Number(submitted.draft.landOfficePrice.replace(/,/g, '')) : null;
        if (dirtyFieldsRef.current.has('bank') && submitted.draft.bank !== originalBaseline.current?.bank) patch.bank_name = submitted.draft.bank.trim() || null;
        if (Object.keys(patch).length) {
          let query = supabase.from('sales').update(patch).eq('id', resolved.saleId);
          for (const key of ['crm_stage', 'contract_status', 'updated_at'] as const) query = currentSale?.[key] == null ? query.is(key, null) : query.eq(key, currentSale[key]);
          if (currentSale?.payment_method != null) query = query.eq('payment_method', currentSale.payment_method);
          if (isLegacySale || currentSale?.booking_route === 'legacy_import') {
            const { error: failure } = await query;
            if (failure) throw failure;
          } else {
            const { data, error: failure } = await query.select('id').single();
            if (failure) throw failure;
            if (!data?.id) throw new Error('ไม่พบรายการขายที่สามารถอัปเดตได้');
          }
          progress.current.sale = true;
        }
        if (!mounted.current) return;
      }

      if (resolved.leadId && !progress.current.lead) {
        const stamp = new Date().toISOString();
        const dealPrice = effectivePrice;
        const dealBank = effectiveBank;
        const dealMethod = effectiveMethod;
        const added = `[${stamp} อัปเดตข้อมูลการขาย โดย ${currentUser?.username || currentUser?.displayName || 'ฝ่ายขาย'}] ${option.label}\n${customerDealSummary(dealPrice, dealBank, effectiveLandOfficePrice)}\n• วิธีชำระเงิน: ${dealMethod === 'cash' ? 'เงินสด' : 'กู้ธนาคาร'}${submitted.reason ? '\n• เหตุผล: ' + submitted.reason : ''}${lifecycle ? '\n• วันที่ทำรายการ: ' + submitted.eventDate : ''}${submitted.note ? '\n' + submitted.note : ''}`;
        const patch: Row = { notes: `${added}\n\n${str(currentLead?.notes)}`, updated_at: stamp };
        if (stageChanged || leadInitial.current !== submitted.target) Object.assign(patch, { status: salesDealLeadStatus(submitted.target), crm_status: option.label });
        if (stageChanged && submitted.target === 'transferred') patch.transferred_date = new Date(submitted.eventDate + 'T12:00:00+07:00').toISOString();
        if (stageChanged && submitted.target === 'cancelled') patch.lost_reason = submitted.reason;
        for (const [key, column] of [['name', 'customer_name'], ['phone', 'phone'], ['occupation', 'occupation'], ['agentName', 'agent_name']] as const) {
          if (dirtyFieldsRef.current.has(key)) patch[column] = submitted.draft[key]?.trim() || null;
        }
        let query = supabase.from('leads').update(patch).eq('id', resolved.leadId);
        query = currentLead?.updated_at == null ? query.is('updated_at', null) : query.eq('updated_at', currentLead.updated_at);
        const { data, error: failure } = await query.select('id').single();
        if (failure) throw failure;
        if (!data?.id) throw new Error('ข้อมูลลูกค้าหรือประวัติในระบบเปลี่ยนไปแล้ว กรุณาโหลดข้อมูลล่าสุด');
        progress.current.lead = true;
      }
      if (!mounted.current) return;
      if (!progress.current.history && (stageChanged || (!resolved.leadId && submitted.note))) {
        const historyCreatedAt = lifecycle ? new Date(submitted.eventDate + 'T12:00:00+07:00').toISOString() : submitted.occurredAt;
        const checkQ = await supabase.from('status_history')
          .select('id')
          .eq('entity_type', resolved.leadId ? 'lead' : 'sale')
          .eq('entity_id', resolved.leadId || resolved.saleId)
          .eq('new_status', submitted.target)
          .eq('created_at', historyCreatedAt)
          .limit(1);

        if (checkQ.data && Array.isArray(checkQ.data) && checkQ.data.length > 0) {
          progress.current.history = true;
        } else {
          const detail = [submitted.reason, submitted.note, effectiveBank ? `ธนาคาร: ${effectiveBank}` : '', `วิธีชำระเงิน: ${effectiveMethod === 'cash' ? 'เงินสด' : 'กู้ธนาคาร'}`, effectiveLandOfficePrice ? `ราคา ทด.13: ฿${effectiveLandOfficePrice.toLocaleString('th-TH')}` : ''].filter(Boolean).join(' | ');
          const result = await supabase.from('status_history').insert({
            entity_type: resolved.leadId ? 'lead' : 'sale', entity_id: resolved.leadId || resolved.saleId,
            old_status: initial, new_status: submitted.target,
            changed_by: `${currentUser?.username || currentUser?.displayName || 'ฝ่ายขาย'}${detail ? ' (' + detail + ')' : ''}`,
            created_at: historyCreatedAt,
          }).select('id').single();
          if (result.error) throw result.error;
          if (!result.data?.id) throw new Error('บันทึกประวัติสถานะยังไม่สำเร็จ');
          progress.current.history = true;
        }
      }
      if (typeof window !== 'undefined') {
        broadcastSalesSync({ type: 'sales_deal_saved', timestamp: Date.now() });
      }
      progress.current.payload = null;
      progress.current.effectiveValues = null;
      dirtyFieldsRef.current.clear();
      originalBaseline.current = { ...submitted.draft };
      setBaselineState({ ...submitted.draft });
      if (mounted.current) onSaved(`อัปเดตข้อมูลลูกค้าและการขายแล้ว${stageChanged ? ` — ${option.label}` : ''}`);
    } catch (failure) {
      if (!mounted.current) return;
      let message = failure instanceof Error ? failure.message : (failure as { message?: string })?.message || 'บันทึกไม่สำเร็จ';
      if ((failure as any)?.code === 'PGRST116' || message.includes('multiple (or no) rows returned') || message.includes('0 rows')) {
        message = 'ข้อมูลถูกแก้ไขจากผู้ใช้อื่นก่อนบันทึก กรุณาโหลดข้อมูลล่าสุด';
      }
      const partial = progress.current.lead || progress.current.sale || progress.current.history;
      setError(`${partial ? 'บันทึกบางส่วนแล้ว ยังไม่ครบ: ' : ''}${message}${partial ? ' กดลองบันทึกต่อโดยไม่เปลี่ยนข้อมูล' : ''}`);
      if (!partial) {
        progress.current.payload = null;
        progress.current.effectiveValues = null;
      }
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  const locked = busy || loading || !resolved || Boolean(progress.current.payload);
  const field = (key: keyof Draft, label: string, disabled = false) => <label className="block text-sm font-semibold">{label}<input aria-label={label} value={draft[key]} disabled={locked || disabled} onChange={e => setDraft({ ...draft, [key]: e.target.value })} className="block w-full border rounded-xl p-2 mt-1 disabled:bg-slate-50" /></label>;
  const resolveConflict = () => {
    const authoritative = serverSnapshot.current;
    const freshStage = authoritative?.stage || stageOf(lead);
    if (authoritative?.leadStage) {
      leadInitial.current = authoritative.leadStage;
    }
    setInitial(freshStage);
    setTarget(freshStage);
    setConfirmed(false);
    if (authoritative?.values && originalBaseline.current) {
      originalBaseline.current = { ...authoritative.values };
      setBaselineState({ ...authoritative.values });
      setDraftState(cur => {
        const next = { ...cur };
        for (const key of Object.keys(authoritative.values) as (keyof Draft)[]) {
          if (!dirtyFieldsRef.current.has(key)) {
            (next as any)[key] = authoritative.values[key];
          }
        }
        draftRef.current = next;
        return next;
      });
    }
    setConflictNotice(null);
    setError("");
  };
  const canSave = Boolean(editable && !protectedSale && !busy && !loading && resolved && (changed || progress.current.payload) && !conflictNotice);
  if (renderEditor) return renderEditor({ draft: protectedSale ? { ...draft, ...protectedSale.details } : draft, setDraft,
    initial: protectedSale?.stage || initial, target: protectedSale?.stage || target, setTarget,
    note, setNote, reason, setReason, eventDate, setEventDate, choices: protectedSale ? [protectedSale.stage] : choices,
    busy, loading, locked: locked || !editable || Boolean(protectedSale), editable: editable && !protectedSale,
    error, resolved, canSave, save, conflictNotice, resolveConflict });
  return <SalesOverlay role="dialog" aria-modal="true" aria-label="สถานะหลังจอง" className="fixed inset-0 z-[300] bg-slate-950/70 flex items-center justify-center p-4">
    <div className="bg-white rounded-2xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto">
      <div className="flex justify-between gap-3"><h2 className="font-bold">{editable && !protectedSale ? 'อัปเดตข้อมูลลูกค้าและการขาย' : 'รายละเอียดสถานะลูกค้า'}</h2><button type="button" disabled={busy} onClick={onClose} className="text-sm font-bold">ปิด</button></div>
      {conflictNotice && (
        <div role="alert" className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900 flex items-center justify-between gap-2">
          <span>⚠️ {conflictNotice}</span>
          <button type="button" onClick={resolveConflict} className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-[11px] shrink-0 cursor-pointer">ยอมรับสถานะใหม่</button>
        </div>
      )}
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
          <div><dt className="font-semibold">ราคา ทด.13</dt><dd>{protectedSale.details.landOfficePrice ? Number(protectedSale.details.landOfficePrice).toLocaleString('th-TH') + ' บาท' : 'ยังไม่ระบุ'}</dd></div>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{field('name', 'ชื่อลูกค้า', !resolved?.leadId)}{field('phone', 'เบอร์โทรศัพท์', !resolved?.leadId)}{field('occupation', 'อาชีพ', !resolved?.leadId)}{field('price', 'ราคาขายสุทธิ')}{field('landOfficePrice', 'ราคา ทด.13 (ประเมินที่ดิน)')}<label className="block text-sm font-semibold">ธนาคาร / วิธีชำระเงิน<select aria-label="ธนาคาร" value={draft.bank} disabled={locked} onChange={e => { setDraft({ ...draft, bank: e.target.value, method: e.target.value === CASH_BANK_OPTION ? 'cash' : 'mortgage' }); setTarget(initial); setConfirmed(false); }} className="block w-full border rounded-xl p-2 mt-1 disabled:bg-slate-50">
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
          {target === 'transferred' && (
            <div className="bg-white/95 rounded-xl p-3 border border-amber-300 shadow-sm text-xs space-y-1.5">
              <div className="font-bold text-slate-800 text-sm mb-1 flex items-center justify-between">
                <span>ข้อมูลราคาในการโอนกรรมสิทธิ์</span>
                <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">ขั้นตอนโอน</span>
              </div>
              <div className="flex justify-between items-center text-slate-700 py-0.5 border-b border-slate-100">
                <span>ราคาขายสุทธิ (ตกลง):</span>
                <span className="font-bold text-slate-900">{draft.price ? `฿${Number(draft.price.replace(/,/g, '')).toLocaleString('th-TH')} บาท` : 'ยังไม่ระบุ'}</span>
              </div>
              <div className="flex justify-between items-center text-slate-700 py-0.5">
                <span>📑 ยอด ทด.13 (ราคาจดทะเบียนที่ดิน):</span>
                <span className="font-bold text-blue-700">{draft.landOfficePrice ? `฿${Number(draft.landOfficePrice.replace(/,/g, '')).toLocaleString('th-TH')} บาท` : <span className="text-amber-700 font-medium">ยังไม่ระบุ (สามารถระบุด้านบนได้)</span>}</span>
              </div>
            </div>
          )}
          <label className="block text-sm font-semibold">วันที่ทำรายการ<input aria-label="วันที่ทำรายการ" type="date" value={eventDate} disabled={locked} onChange={e => { setEventDate(e.target.value); setConfirmed(false); }} className="block w-full border rounded-xl p-2 mt-1" /></label>
          <label className="flex gap-2 text-sm"><input type="checkbox" aria-label="ยืนยันรายการ" checked={confirmed} disabled={locked} onChange={e => setConfirmed(e.target.checked)} />ยืนยัน{stages.find(stage => stage.id === target)?.label} สำหรับลูกค้าและแปลงนี้</label>
          {!resolved?.saleId && <p className="text-sm text-red-700">ยังไม่มีรายการขายที่เชื่อมกับ Lead ต้องตรวจการเชื่อมข้อมูลก่อนบันทึกขั้นตอนนี้</p>}
        </div>}
        <p className="text-xs text-slate-500">แสดงเฉพาะขั้นถัดไปที่ทำได้ เงินสดข้ามสินเชื่อ หลังโอนทำได้เฉพาะส่งมอบ ไม่บันทึกการจองใหม่</p>
      </> : <p className="text-sm text-slate-600">รายการนี้ดูรายละเอียดได้ตามสิทธิ์เดิม รายการส่งมอบแล้วหรือยกเลิกแล้วไม่เปิดแก้ขั้นตอนจากฟอร์มนี้</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {editable && !protectedSale && <button type="button" disabled={!canSave} onClick={() => void save()} className="bg-amber-500 rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-50">{busy ? 'กำลังบันทึก…' : 'บันทึกข้อมูล'}</button>}
    </div>
  </SalesOverlay>;
}

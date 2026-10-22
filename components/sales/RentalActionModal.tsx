"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Key, 
  XCircle, 
  Home, 
  Sparkles, 
  Calendar, 
  DollarSign, 
  Percent, 
  ShieldCheck, 
  AlertCircle, 
  CheckCircle2, 
  ArrowRight,
  LogOut,
  ShoppingBag,
  RefreshCw,
  PiggyBank,
  FileCheck
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { 
  Lead, 
  RentalContract, 
  RentalProgramType, 
  RENTAL_PROGRAM_DETAILS 
} from '@/types/sales';
import { calculateConversionCredit } from '@/lib/rentalHelper';
import { broadcastSalesSync } from '@/lib/sales/salesSyncBroadcast';
import SalesOverlay from './SalesOverlay';
import { extendRentalLeaseEnd, rentalLifecycleActions } from '@/lib/sales/rentalLifecycle';
import { canEditSalesRole } from '@/lib/sales/leadStage';
import { salesDealStageOf } from '@/lib/sales/dealStatus';

interface RentalActionModalProps {
  contractId?: string | null;
  isOpen: boolean;
  onClose: () => void;
  lead?: Lead | null;
  plot?: any | null;
  user?: any;
  onSaved?: () => void;
}

export default function RentalActionModal({
  contractId,
  isOpen,
  onClose,
  lead,
  plot,
  user,
  onSaved
}: RentalActionModalProps) {
  const [activeTab, setActiveTab] = useState<'convert_to_buy' | 'move_out' | 'renew'>('convert_to_buy');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const actionProgress = useRef<{ kind: string; completed: number; steps: (() => Promise<void>)[]; message: string } | null>(null);
  const busy = useRef(false);
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      currentScope.current = 'unmounted:' + Math.random();
    };
  }, []);

  const scope = `${isOpen}:${contractId || lead?.active_rental_contract_id || ''}:${lead?.id || ''}:${plot?.id || ''}:${user?.id || user?.username || ''}:${user?.role || ''}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;

  // Active Contract Data
  const [activeContract, setActiveContract] = useState<RentalContract | null>(null);

  // --- Form 1: Convert to Purchase State ---
  const [purchaseDate, setPurchaseDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [customPurchasePrice, setCustomPurchasePrice] = useState<string>('');
  const [appliedBookingCredit, setAppliedBookingCredit] = useState<string>('');
  const [closingAgent, setClosingAgent] = useState<string>(user?.username || lead?.agent_name || 'ทีมขาย');

  // --- Form 2: Move Out State ---
  const [moveOutDate, setMoveOutDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [utilityDeduction, setUtilityDeduction] = useState<string>('0');
  const [damageDeduction, setDamageDeduction] = useState<string>('0');
  const [cleaningDeduction, setCleaningDeduction] = useState<string>('0');
  const [moveOutNotes, setMoveOutNotes] = useState<string>('');

  // --- Form 3: Renew Lease State ---
  const [renewalMonths, setRenewalMonths] = useState<number>(12);
  const [newMonthlyRent, setNewMonthlyRent] = useState<string>('');
  const [renewalNotes, setRenewalNotes] = useState<string>('');

  // Read only the requested contract; a missing row never authorizes synthetic writes.
  useEffect(() => {
    actionProgress.current = null;
    busy.current = false;
    setSubmitting(false);
    setActiveContract(null);
    setErrorMsg(null);
    if (!isOpen) return;
    let cancelled = false;
    const fetchContract = async () => {
      setLoading(true);
      try {
        const exactId = contractId || lead?.active_rental_contract_id;
        if (!exactId && !lead?.id && !plot?.id) throw new Error('กรุณาระบุสัญญา ลูกค้า หรือแปลง');
        let query = supabase.from('rental_contracts').select('*');
        if (exactId) {
          query = query.eq('id', exactId);
        } else {
          const allowedStatuses = ['Active', 'Renewed'];
          if (lead?.rental_status === 'MovedOut' || lead?.rental_status === 'ConvertedToBuy' || lead?.status === 'MovedOut') {
            allowedStatuses.push('MovedOut', 'ConvertedToBuy');
          } else if (lead?.id) {
            allowedStatuses.push('MovedOut', 'ConvertedToBuy');
          }
          query = query.in('status', allowedStatuses);
          query = lead?.id ? query.eq('lead_id', lead.id) : query.eq('plot_id', plot.id);
        }
        const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
        if (error) throw error;
        const contract = data?.[0] as RentalContract | undefined;

        // Clean name helper for ownership checking
        const clean = (val: unknown) =>
          typeof val === 'string' ? val.trim().toLowerCase().replace(/^(นาย|นาง|นางสาว|คุณ)\s*/, '') : '';
        const contractTenant = clean(contract?.tenant_name);
        const plotTenant = clean(plot?.current_tenant_name);
        const plotCustomer = clean(plot?.customer_name);

        // Does the plot still appear to belong to this contract's tenant?
        const isPlotStillHeldByTenant = Boolean(
          plot && (
            (plotTenant && plotTenant === contractTenant) ||
            (plotCustomer && plotCustomer === contractTenant) ||
            (plot.sale_status === 'Rented' && (!plotTenant || plotTenant === contractTenant))
          )
        );

        // Check if contract is active/renewed, OR in incomplete transition (ConvertedToBuy/MovedOut but lead or plot not fully transitioned)
        let isTransitioning = Boolean(contract && (
          (contract.status === 'ConvertedToBuy' && (
            (lead?.rental_status && lead.rental_status !== 'ConvertedToBuy') ||
            (plot && (plot.sale_status === 'Rented' || isPlotStillHeldByTenant))
          )) ||
          (contract.status === 'MovedOut' && (
            (lead?.rental_status && lead.rental_status !== 'MovedOut') ||
            isPlotStillHeldByTenant
          ))
        ));

        // Recovery: if contract is ConvertedToBuy, but there is NO active sales record created yet for this deal:
        if (contract && contract.status === 'ConvertedToBuy' && !isTransitioning && contract.lead_id && contract.plot_id) {
          const { data: salesData } = await supabase.from('sales')
            .select('id')
            .eq('lead_id', contract.lead_id)
            .eq('plot_id', contract.plot_id)
            .neq('contract_status', 'Cancelled');
          if (!salesData || salesData.length === 0) {
            isTransitioning = true;
          }
        }

        if (!contract || (!['Active', 'Renewed'].includes(contract.status) && !isTransitioning)) {
          throw new Error('ไม่พบสัญญาเช่าที่ดำเนินการได้ สัญญาอาจสิ้นสุดแล้ว');
        }
        if ((lead?.id && contract.lead_id !== lead.id) || (plot?.id && contract.plot_id !== plot.id)) {
          throw new Error('สัญญาไม่ตรงกับลูกค้าหรือแปลงที่เลือก');
        }
        if (!cancelled) {
          setActiveContract(contract);
          setNewMonthlyRent(String(contract.monthly_rent || 15000));
          if (contract.status === 'ConvertedToBuy') setActiveTab('convert_to_buy');
          else if (contract.status === 'MovedOut') setActiveTab('move_out');
        }
      } catch (error) {
        if (!cancelled) setErrorMsg(error instanceof Error ? error.message : 'โหลดสัญญาเช่าไม่สำเร็จ');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void fetchContract();
    return () => { cancelled = true; };
  }, [scope]);

  // Conversion Credit Calculations
  const conversionInfo = useMemo(() => {
    if (!activeContract) return null;
    return calculateConversionCredit(activeContract, purchaseDate);
  }, [activeContract, purchaseDate]);

  useEffect(() => {
    if (conversionInfo) {
      setCustomPurchasePrice(conversionInfo.finalPurchasePrice.toString());
      setAppliedBookingCredit(conversionInfo.suggestedBookingCredit.toString());
    }
  }, [conversionInfo]);

  // Move-Out Refund Calculations
  const moveOutRefund = useMemo(() => {
    if (!activeContract) return 0;
    const initialDeposit = Number(activeContract.security_deposit || 0);
    const util = parseFloat(utilityDeduction) || 0;
    const dmg = parseFloat(damageDeduction) || 0;
    const clean = parseFloat(cleaningDeduction) || 0;
    const totalDeductions = util + dmg + clean;
    return Math.max(0, initialDeposit - totalDeductions);
  }, [activeContract, utilityDeduction, damageDeduction, cleaningDeduction]);

  if (!isOpen) return null;

  const programMeta = activeContract?.program_type 
    ? RENTAL_PROGRAM_DETAILS[activeContract.program_type] 
    : RENTAL_PROGRAM_DETAILS.program_a;

  // Keep completed steps within this open form. Retrying a partial save resumes
  // remaining steps instead of renewing twice or inserting another sales record.
  const updateRow = async (table: string, id: string, payload: Record<string, unknown>, expectedStatus?: string) => {
    let query = supabase.from(table).update(payload).eq('id', id);
    if (expectedStatus) query = query.eq('status', expectedStatus);
    const { data, error } = await query.select('id').single();
    if (error) throw error;
    if (!data?.id) throw new Error('ไม่พบรายการที่แก้ไขได้ กรุณาโหลดข้อมูลใหม่');
  };
  const runAction = async (kind: string, steps: (() => Promise<void>)[], message: string) => {
    if (busy.current || loading || !activeContract) return;
    const isResumingTransition = (activeContract.status === 'MovedOut' && kind === 'move_out') ||
      (activeContract.status === 'ConvertedToBuy' && kind === 'convert_to_buy');
    const allowedActions = rentalLifecycleActions(activeContract.status);
    const actionAllowed = allowedActions.includes(kind as 'renew' | 'convert_to_buy' | 'move_out') || isResumingTransition;

    if ((user?.role != null && !canEditSalesRole(user.role)) || !actionAllowed) {
      setErrorMsg('บัญชีหรือสถานะสัญญานี้ไม่สามารถดำเนินการได้'); return;
    }
    if (actionProgress.current && actionProgress.current.kind !== kind) {
      setErrorMsg('รายการก่อนหน้าบันทึกบางส่วนแล้ว กรุณาดำเนินการรายการเดิมให้ครบ');
      return;
    }
    const requestScope = currentScope.current;
    busy.current = true;
    setSubmitting(true);
    setErrorMsg(null);
    if (actionProgress.current) {
      actionProgress.current.steps = steps;
      actionProgress.current.message = message;
    }
    const progress = actionProgress.current || { kind, completed: 0, steps, message };
    actionProgress.current = progress;
    try {
      while (progress.completed < progress.steps.length) {
        if (!isMounted.current || requestScope !== currentScope.current) return;
        await progress.steps[progress.completed]();
        progress.completed++;
      }
      if (!isMounted.current || requestScope !== currentScope.current) return;
      actionProgress.current = null;
      if (typeof window !== 'undefined') {
        broadcastSalesSync({ type: kind, timestamp: Date.now() });
      }
      if (isMounted.current && requestScope === currentScope.current) {
        onSaved?.();
        onClose();
        alert(progress.message);
      }
    } catch (error) {
      if (isMounted.current && requestScope === currentScope.current) {
        const detail = error instanceof Error ? error.message : (error as { message?: string })?.message || 'บันทึกไม่สำเร็จ';
        if (progress.completed === 0) actionProgress.current = null;
        setErrorMsg(progress.completed > 0
          ? 'บันทึกบางส่วนแล้ว แต่ยังไม่ครบ: ' + detail + ' กดรายการเดิมอีกครั้งเพื่อบันทึกส่วนที่เหลือ'
          : detail);
      }
    } finally {
      if (isMounted.current && requestScope === currentScope.current) {
        busy.current = false;
        setSubmitting(false);
      }
    }
  };

  const handleConvertToBuy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy.current || submitting || loading || !activeContract || !isMounted.current) return;
    const c = activeContract;
    if (!c.lead_id) { setErrorMsg('ต้องเชื่อมสัญญาเช่ากับ Lead ก่อนเปลี่ยนเป็นซื้อ เพื่อเก็บประวัติลูกค้าคนเดิม'); return; }

    const requestScope = currentScope.current;
    setSubmitting(true);
    setErrorMsg(null);

    try {
      const finalPrice = parseFloat(customPurchasePrice) || conversionInfo?.finalPurchasePrice || 0;
      const bookingCredit = parseFloat(appliedBookingCredit) || 0;

      // Fetch fresh state of sales, plots, and leads BEFORE committing steps
      const { data: existingSales, error: selectErr } = await supabase.from('sales')
        .select('id, contract_status, crm_stage, sale_price, booked_at')
        .eq('lead_id', c.lead_id)
        .eq('plot_id', c.plot_id)
        .neq('contract_status', 'Cancelled');

      if (!isMounted.current || requestScope !== currentScope.current) return;
      if (selectErr) {
        setErrorMsg('ตรวจสอบรายการขายไม่สำเร็จ: ' + selectErr.message);
        return;
      }

      const { data: freshLead, error: leadErr } = await supabase.from('leads')
        .select('id, status, rental_status, notes, customer_name')
        .eq('id', c.lead_id)
        .maybeSingle();

      if (!isMounted.current || requestScope !== currentScope.current) return;
      if (leadErr) {
        setErrorMsg('ตรวจสอบข้อมูลลูกค้าไม่สำเร็จ: ' + leadErr.message);
        return;
      }

      const { data: freshPlot, error: plotErr } = await supabase.from('plots')
        .select('id, sale_status, has_customer, current_tenant_name, customer_name')
        .eq('id', c.plot_id)
        .maybeSingle();

      if (!isMounted.current || requestScope !== currentScope.current) return;
      if (plotErr) {
        setErrorMsg('ตรวจสอบข้อมูลแปลงไม่สำเร็จ: ' + plotErr.message);
        return;
      }

      if (!freshPlot) {
        setErrorMsg('ไม่พบข้อมูลแปลงที่เกี่ยวข้อง');
        return;
      }
      if (freshPlot.sale_status === 'Transferred') {
        setErrorMsg('แปลงนี้ถูกโอนกรรมสิทธิ์แล้ว ไม่สามารถดำเนินการได้');
        return;
      }
      const cleanName = (val: unknown) =>
        typeof val === 'string' ? val.trim().toLowerCase().replace(/^(นาย|นาง|นางสาว|คุณ)\s*/, '') : '';
      const cTenantClean = cleanName(c.tenant_name || freshLead?.customer_name);
      const plotTenantClean = cleanName(freshPlot.current_tenant_name);
      const plotCustClean = cleanName(freshPlot.customer_name);

      if (plotTenantClean && cTenantClean && plotTenantClean !== cTenantClean) {
        setErrorMsg(`แปลงนี้มีผู้เช่าอื่นถือสิทธิ์อยู่ (${freshPlot.current_tenant_name}) ไม่สามารถเปลี่ยนเป็นซื้อได้`);
        return;
      }
      if (plotCustClean && cTenantClean && plotCustClean !== cTenantClean && freshPlot.sale_status !== 'Available') {
        setErrorMsg(`แปลงนี้ไม่ได้ถูกผูกสิทธิ์กับลูกค้ารายนี้ (ผู้ถือสิทธิ์ปัจจุบัน: ${freshPlot.customer_name})`);
        return;
      }

      const existingSale = existingSales && existingSales.length > 0 ? existingSales[0] : null;
      if (existingSales && existingSales.length > 1) {
        setErrorMsg('พบรายการขายมากกว่า 1 รายการ กรุณาตรวจสอบข้อมูล');
        return;
      }

      // Canonical stage detection:
      // A deal is in an advanced stage if its canonical sales deal stage is beyond initial booking.
      const saleStage = existingSale ? salesDealStageOf(existingSale) : 'booked';
      const leadStage = freshLead ? salesDealStageOf(freshLead) : 'booked';
      const plotStage = freshPlot ? salesDealStageOf({ status: freshPlot.sale_status }) : 'booked';

      const isSaleAdvanced = saleStage !== 'booked' && saleStage !== 'cancelled';
      const isLeadAdvanced = leadStage !== 'booked' && leadStage !== 'cancelled';
      const isPlotAdvanced = plotStage !== 'booked' && plotStage !== 'cancelled';

      const steps: (() => Promise<void>)[] = [];

      // 1. Contract update
      if (c.status !== 'ConvertedToBuy') {
        const convertContractLog = 'เปลี่ยนจากเช่าเป็นซื้อเมื่อ ' + purchaseDate + ' (หักเครดิต/เงินสะสม ' + bookingCredit.toLocaleString() + ' บาท)';
        const existingNotes = c.notes || '';
        const finalContractNotes = existingNotes.includes(convertContractLog)
          ? existingNotes
          : existingNotes ? `${existingNotes}\n${convertContractLog}` : convertContractLog;

        steps.push(() => updateRow('rental_contracts', c.id, {
          status: 'ConvertedToBuy', conversion_date: purchaseDate,
          notes: finalContractNotes.trim()
        }, c.status));
      }

      // 2. Plot update: Do NOT downgrade if already advanced
      if (isPlotAdvanced) {
        steps.push(() => updateRow('plots', c.plot_id, {
          current_tenant_name: null, current_tenant_phone: null, rental_program: null,
          monthly_rent: null, security_deposit: null, lease_start_date: null, lease_end_date: null
        }));
      } else {
        steps.push(() => updateRow('plots', c.plot_id, {
          sale_status: 'Reserved', has_customer: true, current_tenant_name: null,
          current_tenant_phone: null, rental_program: null, highlight_note: 'จองซื้อ (เปลี่ยนจากเช่า ' + programMeta.name + ')'
        }));
      }

      // 3. Lead update: Do NOT downgrade if already advanced
      if (c.lead_id) {
        if (isLeadAdvanced) {
          steps.push(() => updateRow('leads', c.lead_id!, {
            deal_type: 'buy',
            rental_status: 'ConvertedToBuy'
          }));
        } else {
          const convertLeadLog = `[เปลี่ยนจากเช่าเป็นซื้อ ${purchaseDate}]: ยอดหักสะสม ${bookingCredit.toLocaleString()} บ. ราคาขายสุทธิ ${finalPrice.toLocaleString()} บ.`;
          const existingNotes = (freshLead?.notes ?? lead?.notes ?? '').trim();
          const finalLeadNotes = existingNotes.includes(convertLeadLog)
            ? existingNotes
            : existingNotes ? `${existingNotes}\n${convertLeadLog}` : convertLeadLog;

          steps.push(() => updateRow('leads', c.lead_id!, {
            deal_type: 'buy', status: 'Booked', crm_status: 'Booked — จองแล้ว',
            booking_date: purchaseDate, booking_amount: bookingCredit,
            notes: finalLeadNotes.trim(),
            rental_status: 'ConvertedToBuy'
          }));
        }

        // 4. Sales update/insert: Fresh query inside execution to guarantee idempotency on retries
        steps.push(async () => {
          const { data: currentSales, error: checkErr } = await supabase.from('sales')
            .select('id, contract_status, crm_stage')
            .eq('lead_id', c.lead_id)
            .eq('plot_id', c.plot_id)
            .neq('contract_status', 'Cancelled');

          if (checkErr) throw checkErr;
          const targetSale = (currentSales && currentSales.length > 0) ? currentSales[0] : null;

          if (targetSale) {
            const targetStage = salesDealStageOf(targetSale);
            if (targetStage === 'booked') {
              const updatePayload: Record<string, unknown> = {
                contract_status: 'Reserved',
                crm_stage: 'booked',
                sale_price: finalPrice,
                booked_at: purchaseDate + 'T12:00:00Z',
                updated_at: new Date().toISOString()
              };
              const { error: updErr } = await supabase.from('sales').update(updatePayload).eq('id', targetSale.id);
              if (updErr) throw updErr;
            }
          } else {
            const { data, error } = await supabase.from('sales').insert([{
              lead_id: c.lead_id, plot_id: c.plot_id, contract_status: 'Reserved',
              crm_stage: 'booked', sale_price: finalPrice, booked_at: purchaseDate + 'T12:00:00Z',
              created_at: new Date().toISOString()
            }]).select('id').single();
            if (error) throw error;
            if (!data?.id) throw new Error('บันทึกรายการขายไม่สำเร็จ');
          }
        });
      }
      if (!isMounted.current || requestScope !== currentScope.current) return;
      await runAction('convert_to_buy', steps, '🎉 เปลี่ยนสถานะสำเร็จ! คุณ ' + c.tenant_name + ' เปลี่ยนเป็นผู้จองซื้อแปลง ' + (c.plot_name || c.plot_id) + ' เรียบร้อยแล้ว');
    } finally {
      if (isMounted.current && requestScope === currentScope.current && (!actionProgress.current || actionProgress.current.completed === 0)) {
        busy.current = false;
        setSubmitting(false);
      }
    }
  };

  const handleMoveOut = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeContract) return;
    const c = activeContract;
    const steps: (() => Promise<void>)[] = [];
    if (c.status !== 'MovedOut') {
      const moveOutLog = ('ย้ายออกเมื่อ ' + moveOutDate + ' (คืนเงินประกันสุทธิ ' + moveOutRefund.toLocaleString() + ' บาท)' + (moveOutNotes ? ' ' + moveOutNotes.trim() : '')).trim();
      const existingCNotes = c.notes || '';
      const finalCNotes = existingCNotes.includes(moveOutLog)
        ? existingCNotes
        : existingCNotes ? `${existingCNotes}\n${moveOutLog}` : moveOutLog;

      steps.push(() => updateRow('rental_contracts', c.id, {
        status: 'MovedOut', move_out_date: moveOutDate, deposit_refunded: moveOutRefund,
        notes: finalCNotes.trim()
      }, c.status));
    }
    steps.push(async () => {
      // Query fresh plot state to guarantee we do NOT wipe another tenant
      const { data: freshPlot, error: pErr } = await supabase
        .from('plots')
        .select('id, sale_status, has_customer, current_tenant_name, customer_name')
        .eq('id', c.plot_id)
        .maybeSingle();

      if (pErr) throw pErr;
      if (!freshPlot) return;

      const clean = (val: unknown) =>
        typeof val === 'string' ? val.trim().toLowerCase().replace(/^(นาย|นาง|นางสาว|คุณ)\s*/, '') : '';
      const pTenant = clean(freshPlot.current_tenant_name);
      const pCust = clean(freshPlot.customer_name);
      const cTenant = clean(c.tenant_name);

      // If plot is currently occupied by someone else, DO NOT wipe it
      if ((pTenant && cTenant && pTenant !== cTenant) ||
          (pCust && cTenant && pCust !== cTenant)) {
        return;
      }

      // If plot is held by this tenant, release it
      if (freshPlot.has_customer || freshPlot.sale_status !== 'Available') {
        let upd = supabase
          .from('plots')
          .update({
            sale_status: 'Available', has_customer: false, current_tenant_name: null,
            current_tenant_phone: null, rental_program: null, monthly_rent: null,
            security_deposit: null, lease_start_date: null, lease_end_date: null, highlight_note: null
          }, { count: 'exact' })
          .eq('id', c.plot_id);

        if (freshPlot.current_tenant_name) {
          upd = upd.eq('current_tenant_name', freshPlot.current_tenant_name);
        }
        const updRes: any = await upd.select('id');
        if (updRes?.error) throw updRes.error;
        if (updRes?.count === 0 || (Array.isArray(updRes?.data) && updRes.data.length === 0)) {
          throw new Error('ไม่สามารถคืนแปลงได้ เนื่องจากข้อมูลแปลงมีการเปลี่ยนแปลงหรือไม่มีสิทธิ์ (0 rows updated)');
        }
      }
    });

    if (c.lead_id) steps.push(async () => {
      const { data: freshLead, error: leadErr } = await supabase
        .from('leads')
        .select('notes')
        .eq('id', c.lead_id)
        .maybeSingle();

      if (leadErr) {
        throw new Error('ไม่สามารถอ่านโน้ตล่าสุดของลูกค้าได้: ' + leadErr.message);
      }
      if (!freshLead) {
        throw new Error('ไม่พบข้อมูลลูกค้าสำหรับอัปเดตโน้ต');
      }

      const baseNotes = (freshLead.notes || '').trim();
      const moveOutLeadLog = `[สิ้นสุดสัญญาเช่า ย้ายออก ${moveOutDate}]: คืนเงินประกัน ${moveOutRefund.toLocaleString()} บ.${moveOutNotes ? ` หมายเหตุ: ${moveOutNotes.trim()}` : ''}`;
      const finalNotes = baseNotes.includes(moveOutLeadLog)
        ? baseNotes
        : baseNotes ? `${baseNotes}\n${moveOutLeadLog}` : moveOutLeadLog;

      await updateRow('leads', c.lead_id!, {
        status: 'MovedOut', crm_status: 'Lease Ended / Moved Out — สิ้นสุดสัญญาเช่า (ย้ายออก)', rental_status: 'MovedOut',
        notes: finalNotes.trim()
      });
    });
    await runAction('move_out', steps, '📦 สิ้นสุดสัญญาเรียบร้อย! ปลดแปลง ' + (c.plot_name || c.plot_id) + ' กลับมาเป็นแปลงว่างพร้อมขาย/เช่าแล้ว');
  };

  const handleRenewLease = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeContract) return;
    const c = activeContract;
    let newEndDate: string;
    try { newEndDate = extendRentalLeaseEnd(c.lease_end_date, renewalMonths); }
    catch (error) { setErrorMsg(error instanceof Error ? error.message : 'วันที่สิ้นสุดสัญญาไม่ถูกต้อง'); return; }
    const rentNum = parseFloat(newMonthlyRent) || c.monthly_rent;
    const renewalLog = `[ต่อสัญญาเช่า +${renewalMonths} เดือน]: สิ้นสุดใหม่ ${newEndDate}`;
    const existingCNotes = c.notes || '';
    const finalCNotes = existingCNotes.includes(renewalLog)
      ? existingCNotes
      : existingCNotes ? `${existingCNotes}\n${renewalLog}` : renewalLog;

    const steps = [
      () => updateRow('rental_contracts', c.id, {
        status: 'Renewed', lease_duration_months: (c.lease_duration_months || 12) + renewalMonths,
        lease_end_date: newEndDate, monthly_rent: rentNum,
        notes: finalCNotes.trim()
      }, c.status),
      () => updateRow('plots', c.plot_id, { monthly_rent: rentNum, lease_end_date: newEndDate })
    ];
    if (c.lead_id) steps.push(async () => {
      const { data: freshLead, error: leadErr } = await supabase
        .from('leads')
        .select('notes')
        .eq('id', c.lead_id)
        .maybeSingle();

      if (leadErr) {
        throw new Error('ไม่สามารถอ่านโน้ตล่าสุดของลูกค้าได้: ' + leadErr.message);
      }
      if (!freshLead) {
        throw new Error('ไม่พบข้อมูลลูกค้าสำหรับอัปเดตโน้ต');
      }

      const baseNotes = (freshLead.notes || '').trim();
      const finalNotes = baseNotes.includes(renewalLog)
        ? baseNotes
        : baseNotes ? `${baseNotes}\n${renewalLog}` : renewalLog;

      await updateRow('leads', c.lead_id!, {
        rental_status: 'Renewed', rental_end_date: newEndDate, rental_monthly_rent: rentNum,
        notes: finalNotes.trim()
      });
    });
    await runAction('renew', steps, '📝 ต่อสัญญาเช่าสำเร็จ! ขยายเวลาสัญญาถึงวันที่ ' + newEndDate);
  };

  return (
    <SalesOverlay className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto animate-fade-in">
      <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-auto flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-900 via-slate-900 to-blue-950 text-white px-6 py-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-white/10 text-cyan-300 rounded-2xl border border-cyan-400/30">
              <Key size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-lg text-white">
                  🔑 จัดการสัญญาเช่า (Manage Lease Lifecycle)
                </h3>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${programMeta.badgeColor}`}>
                  แบบ {programMeta.code}: {programMeta.name}
                </span>
              </div>
              <p className="text-xs text-indigo-200/80 mt-0.5">
                ผู้เช่า: <span className="text-white font-bold">{activeContract?.tenant_name || 'ลูกค้า'}</span> | แปลง: <span className="text-white font-bold">{activeContract?.plot_name || activeContract?.plot_id}</span>
              </p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            className="text-white/70 hover:text-white transition-colors cursor-pointer"
          >
            <XCircle size={22} />
          </button>
        </div>

        {/* Action Tabs */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-6 pt-3 gap-2 shrink-0">
          <button
            type="button"
            disabled={submitting || (actionProgress.current?.completed || 0) > 0 || activeContract?.status === 'MovedOut'}
            onClick={() => setActiveTab('convert_to_buy')}
            className={`pb-3 px-3 font-bold text-xs flex items-center gap-1.5 transition-all border-b-2 cursor-pointer ${
              activeTab === 'convert_to_buy'
                ? 'border-emerald-600 text-emerald-700 font-black'
                : 'border-transparent text-slate-500 hover:text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed'
            }`}
          >
            <ShoppingBag size={15} /> 🏡 1. เปลี่ยนเป็นซื้อ (Convert to Buy)
          </button>

          <button
            type="button"
            disabled={submitting || (actionProgress.current?.completed || 0) > 0 || activeContract?.status === 'MovedOut' || activeContract?.status === 'ConvertedToBuy'}
            onClick={() => setActiveTab('renew')}
            className={`pb-3 px-3 font-bold text-xs flex items-center gap-1.5 transition-all border-b-2 cursor-pointer ${
              activeTab === 'renew'
                ? 'border-blue-600 text-blue-700 font-black'
                : 'border-transparent text-slate-500 hover:text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed'
            }`}
          >
            <RefreshCw size={15} /> 📝 2. ต่อสัญญาเช่า (Renew)
          </button>

          <button
            type="button"
            disabled={submitting || (actionProgress.current?.completed || 0) > 0 || activeContract?.status === 'ConvertedToBuy'}
            onClick={() => setActiveTab('move_out')}
            className={`pb-3 px-3 font-bold text-xs flex items-center gap-1.5 transition-all border-b-2 cursor-pointer ${
              activeTab === 'move_out'
                ? 'border-rose-600 text-rose-700 font-black'
                : 'border-transparent text-slate-500 hover:text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed'
            }`}
          >
            <LogOut size={15} /> 📦 3. สิ้นสุดสัญญา / ย้ายออก
          </button>
        </div>

        <div className="p-5 sm:p-6 text-xs overflow-y-auto flex-1 dark-scrollbar">
          {loading && <p role="status" className="mb-4 text-slate-500">กำลังโหลดสัญญาเช่า...</p>}
          {errorMsg && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center gap-2 font-medium">
              <AlertCircle size={16} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* 🌟 Tab 1: Convert to Buy 🌟 */}
          {activeTab === 'convert_to_buy' && (
            <form onSubmit={handleConvertToBuy} className="space-y-4">
              <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200/80 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-emerald-950 text-xs flex items-center gap-1.5">
                    <Sparkles size={16} className="text-emerald-600" /> สิทธิประโยชน์ตามโปรแกรม {programMeta.name}
                  </div>
                  <span className="text-[11px] bg-emerald-200/70 text-emerald-900 font-bold px-2 py-0.5 rounded-full">
                    อยู่มาแล้ว {conversionInfo?.monthsRented || 1} เดือน
                  </span>
                </div>

                {activeContract?.program_type === 'program_b' && (
                  <div className="p-3 bg-white rounded-xl border border-emerald-200 space-y-1">
                    <div className="text-[11px] text-slate-600 flex items-center justify-between">
                      <span>เงินสะสมซื้อบ้าน 5,000 บ. × {conversionInfo?.monthsRented} เดือน:</span>
                      <span className="font-bold text-amber-700 text-xs">
                        {conversionInfo?.accumulatedSavings.toLocaleString()} บาท
                      </span>
                    </div>
                    <div className="text-[10px] text-emerald-700 font-semibold">
                      ✨ นำยอดเงินสะสมนี้ไปหักลบออกจากราคาขายบ้านทันทีเมื่อโอนกรรมสิทธิ์
                    </div>
                  </div>
                )}

                {activeContract?.program_type === 'program_c' && (
                  <div className="p-3 bg-white rounded-xl border border-emerald-200 space-y-1">
                    <div className="text-[11px] text-slate-600 flex items-center justify-between">
                      <span>สิทธิ์ส่วนลดราคาฐาน (โอนภายใน {conversionInfo?.monthsRented && conversionInfo.monthsRented <= 12 ? '1 ปี (-10%)' : '2 ปี (-5%)'}):</span>
                      <span className="font-bold text-emerald-700 text-xs">
                        - {conversionInfo?.applicableDiscountAmount.toLocaleString()} บาท ({conversionInfo?.applicableDiscountPct}%)
                      </span>
                    </div>
                    <div className="text-[10px] text-emerald-700 font-semibold">
                      ✨ ราคาฐาน {conversionInfo?.basePrice.toLocaleString()} บ. ลดเหลือ {conversionInfo?.finalPurchasePrice.toLocaleString()} บ.
                    </div>
                  </div>
                )}

                {activeContract?.program_type === 'program_a' && (
                  <div className="p-3 bg-white rounded-xl border border-blue-200 text-slate-600 text-[11px]">
                    สามารถนำเงินประกันสัญญาเช่า ({Number(activeContract.security_deposit || 0).toLocaleString()} บ.) มาเปลี่ยนเป็นเงินจองซื้อบ้านได้
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">วันที่ตัดสินใจซื้อ *</label>
                  <input
                    disabled={submitting || (actionProgress.current?.completed || 0) > 0}
                    type="date"
                    required
                    value={purchaseDate}
                    onChange={e => setPurchaseDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">เซลส์ผู้ปิดการขาย (Closing Agent)</label>
                  <input
                    disabled={submitting || (actionProgress.current?.completed || 0) > 0}
                    type="text"
                    value={closingAgent}
                    onChange={e => setClosingAgent(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">ยอดเงินจอง/เงินสะสมที่นำมาหัก (บาท)</label>
                  <input
                    disabled={submitting || (actionProgress.current?.completed || 0) > 0}
                    type="number"
                    min="0"
                    value={appliedBookingCredit}
                    onChange={e => setAppliedBookingCredit(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-bold text-emerald-800 focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">ราคาขายสุทธิหลังหักส่วนลด (บาท)</label>
                  <input
                    disabled={submitting || (actionProgress.current?.completed || 0) > 0}
                    type="number"
                    min="0"
                    value={customPurchasePrice}
                    onChange={e => setCustomPurchasePrice(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-black text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-50 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={submitting || loading || !activeContract}
                  className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-md shadow-emerald-600/20 cursor-pointer flex items-center gap-2 transition-all disabled:opacity-50"
                >
                  <FileCheck size={15} />
                  {submitting ? 'กำลังเปลี่ยนเป็นซื้อ...' : 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้'}
                </button>
              </div>
            </form>
          )}

          {/* 🌟 Tab 2: Renew Lease 🌟 */}
          {activeTab === 'renew' && (
            <form onSubmit={handleRenewLease} className="space-y-4">
              <div className="p-4 bg-blue-50 rounded-2xl border border-blue-200/80 space-y-2">
                <div className="font-bold text-blue-900 text-xs">
                  ต่อสัญญาเช่าเดิม (Lease Renewal)
                </div>
                <div className="text-[11px] text-blue-700">
                  สัญญาปัจจุบันจะสิ้นสุดในวันที่: <b>{activeContract?.lease_end_date || '-'}</b>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">ขยายระยะเวลาสัญญา (เดือน)</label>
                  <select
                    disabled={submitting || (actionProgress.current?.completed || 0) > 0}
                    value={renewalMonths}
                    onChange={e => setRenewalMonths(parseInt(e.target.value) || 12)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-bold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value={6}>+ 6 เดือน</option>
                    <option value={12}>+ 12 เดือน (1 ปี)</option>
                    <option value={24}>+ 24 เดือน (2 ปี)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">ค่าเช่าต่อเดือนใหม่ (บาท)</label>
                  <input
                    disabled={submitting || (actionProgress.current?.completed || 0) > 0}
                    type="number"
                    min="0"
                    step="any"
                    value={newMonthlyRent}
                    onChange={e => setNewMonthlyRent(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-bold text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">หมายเหตุการต่อสัญญา</label>
                <textarea
                    disabled={submitting || (actionProgress.current?.completed || 0) > 0}
                  rows={2}
                  value={renewalNotes}
                  onChange={e => setRenewalNotes(e.target.value)}
                  placeholder="เช่น ปรับค่าเช่าตามเงื่อนไขปีที่ 2, ตรวจสอบสภาพบ้านแล้วเรียบร้อย..."
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-50 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={submitting || loading || !activeContract}
                  className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-md shadow-blue-600/20 cursor-pointer flex items-center gap-2 transition-all disabled:opacity-50"
                >
                  <RefreshCw size={15} />
                  {submitting ? 'กำลังต่อสัญญา...' : 'ยืนยันต่อสัญญาเช่า'}
                </button>
              </div>
            </form>
          )}

          {/* 🌟 Tab 3: Move Out 🌟 */}
          {activeTab === 'move_out' && (
            <form onSubmit={handleMoveOut} className="space-y-4">
              <div className="p-4 bg-rose-50 rounded-2xl border border-rose-200/80 space-y-2">
                <div className="font-bold text-rose-900 text-xs flex items-center gap-1.5">
                  <LogOut size={16} className="text-rose-600" /> สิ้นสุดสัญญาเช่า & คืนเงินประกัน
                </div>
                <div className="text-[11px] text-rose-700">
                  เงินประกันตั้งต้นที่ลูกค้าเคยวางไว้: <b>{Number(activeContract?.security_deposit || 0).toLocaleString()} บาท</b>
                </div>
                <div className="text-[10px] text-slate-500">
                  เมื่อกดยืนยัน แปลง {activeContract?.plot_name || activeContract?.plot_id} จะถูกปลดล็อกกลับมาเป็น <b>สถานะว่าง</b> ให้เปิดขายหรือปล่อยเช่าต่อได้ทันที
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">วันที่ย้ายออก *</label>
                  <input
                    disabled={submitting || (actionProgress.current?.completed || 0) > 0}
                    type="date"
                    required
                    value={moveOutDate}
                    onChange={e => setMoveOutDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-rose-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">หักค่าน้ำ / ค่าไฟค้างชำระ (บาท)</label>
                  <input
                    disabled={submitting || (actionProgress.current?.completed || 0) > 0}
                    type="number"
                    min="0"
                    value={utilityDeduction}
                    onChange={e => setUtilityDeduction(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-rose-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">หักค่าความเสียหาย/ซ่อมแซม (บาท)</label>
                  <input
                    disabled={submitting || (actionProgress.current?.completed || 0) > 0}
                    type="number"
                    min="0"
                    value={damageDeduction}
                    onChange={e => setDamageDeduction(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-rose-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">หักค่าทำความสะอาด (บาท)</label>
                  <input
                    disabled={submitting || (actionProgress.current?.completed || 0) > 0}
                    type="number"
                    min="0"
                    value={cleaningDeduction}
                    onChange={e => setCleaningDeduction(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-rose-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Net Deposit Refund Box */}
              <div className="p-3 bg-slate-100 rounded-xl border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="font-bold text-slate-800 text-xs">ยอดเงินประกันสุทธิที่ต้องคืนลูกค้า:</span>
                  <p className="text-[10px] text-slate-500 mt-0.5">เงินประกันตั้งต้น - รายการหักทั้งหมด</p>
                </div>
                <div className="text-sm font-black text-rose-700 bg-white px-3 py-1.5 rounded-xl border border-slate-300 shadow-sm">
                  {moveOutRefund.toLocaleString()} บาท
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">หมายเหตุการย้ายออก / ตรวจรับบ้าน</label>
                <textarea
                    disabled={submitting || (actionProgress.current?.completed || 0) > 0}
                  rows={2}
                  value={moveOutNotes}
                  onChange={e => setMoveOutNotes(e.target.value)}
                  placeholder="เช่น ตรวจมิเตอร์น้ำไฟแล้วเรียบร้อย, คืนกุญแจครบ 3 ดอก..."
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 font-medium focus:ring-2 focus:ring-rose-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-50 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={submitting || loading || !activeContract}
                  className="px-6 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold shadow-md shadow-rose-600/20 cursor-pointer flex items-center gap-2 transition-all disabled:opacity-50"
                >
                  <LogOut size={15} />
                  {submitting ? 'กำลังบันทึกย้ายออก...' : 'ยืนยันการย้ายออก & ปลดแปลงว่าง'}
                </button>
              </div>
            </form>
          )}

        </div>
      </div>
    </SalesOverlay>
  );
}

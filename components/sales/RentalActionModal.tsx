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
import { parseEvidenceTimestamp } from '@/lib/sales/leadEvidence';

const createSaleId = (): string => {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues !== 'function') {
    throw new Error('ไม่สามารถสร้างรหัสรายการขายได้ กรุณาใช้เบราว์เซอร์ที่รองรับการสร้างรหัสอย่างปลอดภัย');
  }
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const sameSaleTimestamp = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  const parsedLeft = parseEvidenceTimestamp(left);
  const parsedRight = parseEvidenceTimestamp(right);
  return parsedLeft !== null && parsedRight !== null && parsedLeft === parsedRight;
};

const cleanName = (val: unknown) =>
  typeof val === 'string' ? val.trim().toLowerCase().replace(/^(นาย|นาง|นางสาว|คุณ)\s*/, '') : '';

const unwrapRow = (d: any): any =>
  (Array.isArray(d) ? d[0] : d) ?? null;

const isZeroRowPostgrestError = (err: any): boolean => {
  if (!err) return false;
  const code = String(err.code || '');
  if (code === '42501' || code.startsWith('28') || code.startsWith('08')) return false;
  const msg = `${err.code || ''} ${err.message || ''} ${err.details || ''}`;
  return code === 'PGRST116' || msg.includes('PGRST116') || msg.includes('multiple (or no) rows returned') || msg.includes('0 rows');
};

const selectMaybeSingleId = (query: any) => {
  const selected = query.select('id');
  if (typeof selected?.maybeSingle === 'function') return selected.maybeSingle();
  if (typeof selected?.single === 'function') return selected.single();
  return selected;
};

const ensureRowUpdated = (res: any, zeroRowMessage: string) => {
  if (res?.error) {
    if (isZeroRowPostgrestError(res.error)) {
      throw new Error(zeroRowMessage);
    }
    throw res.error;
  }
  const updatedRow = unwrapRow(res?.data);
  if (
    res?.count === 0 ||
    (Array.isArray(res?.data) && res.data.length === 0) ||
    !updatedRow?.id
  ) {
    throw new Error(zeroRowMessage);
  }
  return updatedRow;
};

const LEAD_LIFECYCLE_KEYS = [
  'status', 'rental_status', 'crm_status', 'deal_type', 'booking_date',
  'booking_amount', 'active_rental_contract_id', 'rental_monthly_rent',
  'rental_end_date', 'rental_deposit', 'rental_start_date'
] as const;

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
  type InitialSaleSnapshot = {
    hadExistingSale: boolean;
    saleId: string | null;
    contractStatus?: string | null;
    crmStage?: string | null;
    salePrice?: number | null;
    bookedAt?: string | null;
    updatedAt?: string | null;
  };
  type SaleWriteAttemptStatus =
    | 'not_sent'
    | 'failed_before_commit'
    | 'unknown_or_lost_response'
    | 'confirmed_success';
  type SaleWriteAttempt = {
    status: SaleWriteAttemptStatus;
    mode: 'insert' | 'update';
    targetSaleId: string | null;
    writtenPayload: {
      contractStatus: string;
      crmStage: string;
      salePrice: number;
      bookedAt: string;
      createdAt?: string;
      updatedAt?: string;
    };
  };
  type PlotUpdateOutcome = 'updated' | 'already_satisfied' | 'kept_for_other_holder';
  const actionProgress = useRef<{
    kind: string;
    completed: number;
    steps: (() => Promise<void>)[];
    message: string;
    plotLabel?: string;
    plotOutcome?: PlotUpdateOutcome;
    initialSaleSnapshot?: InitialSaleSnapshot;
    saleWriteAttempt?: SaleWriteAttempt;
  } | null>(null);
  const busy = useRef(false);
  const convertBusy = useRef(false);
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
    convertBusy.current = false;
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

        const contractTenant = cleanName(contract?.tenant_name);
        const plotTenant = cleanName(plot?.current_tenant_name);
        const plotCustomer = cleanName(plot?.customer_name);

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
    const res = await selectMaybeSingleId(query);
    ensureRowUpdated(res, 'ไม่พบรายการที่แก้ไขได้ กรุณาโหลดข้อมูลใหม่');
  };

  type NoteGuardOptions = {
    expectedStatus?: string;
    allowedStatuses?: string[];
    expectedLeaseEndDate?: string;
    contractId?: string;
    actionKind?: string;
  };

  const freshNotesNull = (val: unknown) => val === null || val === undefined;

  const updateRowWithNotes = async (
    table: string,
    id: string,
    basePayload: Record<string, unknown>,
    logMessage: string,
    userNotes?: string,
    expectedStatusOrGuard?: string | NoteGuardOptions
  ) => {
    const guard: NoteGuardOptions = typeof expectedStatusOrGuard === 'string'
      ? { expectedStatus: expectedStatusOrGuard, allowedStatuses: [expectedStatusOrGuard] }
      : expectedStatusOrGuard || {};

    const cols = table === 'leads'
      ? 'id, status, rental_status, notes, active_rental_contract_id'
      : 'id, status, notes, lease_end_date';
    const readRow = async () => {
      const { data, error } = await supabase.from(table).select(cols).eq('id', id).maybeSingle();
      return { row: unwrapRow(data), error };
    };

    let { row: current, error: readErr } = await readRow();
    if (readErr) {
      throw new Error(table === 'leads'
        ? 'ไม่สามารถอ่านโน้ตล่าสุดของลูกค้าได้: ' + readErr.message
        : `ไม่สามารถอ่านข้อมูลล่าสุดของ ${table} ได้: ${readErr.message}`);
    }
    if (!current?.id) throw new Error('ไม่พบรายการที่แก้ไขได้ กรุณาโหลดข้อมูลใหม่');

    const payloadToApply = { ...basePayload };
    const validateAndFilter = (row: any, isRetry: boolean) => {
      if (table === 'rental_contracts' && (row.status === 'Cancelled' || (row.status && guard.allowedStatuses?.length && !guard.allowedStatuses.includes(row.status)))) {
        throw new Error(isRetry
          ? 'ไม่พบรายการที่แก้ไขได้ หรือสถานะสัญญาเช่ามีการเปลี่ยนแปลงแล้ว กรุณาโหลดข้อมูลใหม่'
          : 'ไม่พบรายการที่แก้ไขได้ กรุณาโหลดข้อมูลใหม่');
      }
      if (table === 'leads' && (row.status === 'Cancelled' || row.status === 'Lost')) {
        throw new Error('สถานะของลูกค้าถูกยกเลิกแล้ว ไม่สามารถดำเนินการได้');
      }
      if (row.status && guard.allowedStatuses?.length && !guard.allowedStatuses.includes(row.status)) {
        throw new Error(`สถานะของลูกค้าในระบบเปลี่ยนเป็น "${row.status}" แล้ว ไม่สามารถดำเนินการได้`);
      }
      if (table === 'rental_contracts' && guard.expectedLeaseEndDate && row.lease_end_date && row.lease_end_date !== guard.expectedLeaseEndDate) {
        throw new Error('ข้อมูลเงื่อนไขสัญญาเช่าในระบบมีการเปลี่ยนแปลงแล้ว กรุณาโหลดข้อมูลใหม่ก่อนทำรายการ');
      }
      if (guard.contractId && table === 'leads') {
        if (!isRetry && !('active_rental_contract_id' in row)) {
          delete payloadToApply.active_rental_contract_id;
        } else if (row.active_rental_contract_id && row.active_rental_contract_id !== guard.contractId) {
          if (guard.actionKind === 'convert_to_buy') {
            throw new Error('สัญญานี้ไม่ใช่สัญญาเช่าปัจจุบันที่ผูกกับลูกค้า (มีสัญญาเช่าอื่นถือสิทธิ์อยู่) ไม่สามารถเปลี่ยนเป็นซื้อได้');
          }
          for (const k of LEAD_LIFECYCLE_KEYS) delete payloadToApply[k];
        }
      }
    };
    validateAndFilter(current, false);

    const entry = userNotes?.trim() ? `${logMessage} หมายเหตุ: ${userNotes.trim()}` : logMessage;
    const isOptimisticLockConflict = (err: any, res: any) => {
      if (err) {
        return isZeroRowPostgrestError(err);
      }
      if (res?.count === 0 || (Array.isArray(res?.data) && res.data.length === 0)) return true;
      return !unwrapRow(res?.data ?? res)?.id;
    };

    for (let attempt = 0; attempt <= 3; attempt++) {
      const currentNotes = (current.notes || '').trim();
      let mergedNotes = currentNotes;
      if (logMessage && !mergedNotes.includes(logMessage)) {
        mergedNotes = mergedNotes ? `${mergedNotes}\n${entry}` : entry;
      } else if (userNotes?.trim() && !mergedNotes.includes(userNotes.trim())) {
        mergedNotes = mergedNotes ? `${mergedNotes}\nหมายเหตุ: ${userNotes.trim()}` : `หมายเหตุ: ${userNotes.trim()}`;
      }

      let upd = supabase.from(table).update({ ...payloadToApply, notes: mergedNotes.trim() }).eq('id', id);
      upd = freshNotesNull(current.notes) ? upd.is('notes', null) : upd.eq('notes', current.notes);

      const targetStatusGuard = guard.expectedStatus || (guard.allowedStatuses?.includes(current.status) ? current.status : undefined);
      if (targetStatusGuard) upd = upd.eq('status', targetStatusGuard);
      if (table === 'rental_contracts' && guard.expectedLeaseEndDate) upd = upd.eq('lease_end_date', guard.expectedLeaseEndDate);
      if (table === 'leads' && 'active_rental_contract_id' in current) {
        if (current.active_rental_contract_id === null) upd = upd.is('active_rental_contract_id', null);
        else if (typeof current.active_rental_contract_id === 'string') upd = upd.eq('active_rental_contract_id', current.active_rental_contract_id);
      }

      const updRes: any = await selectMaybeSingleId(upd);
      const updErr = updRes?.error;
      if (!updErr && updRes?.count !== 0 && !(Array.isArray(updRes?.data) && updRes.data.length === 0) && unwrapRow(updRes?.data)?.id) return;
      if (!isOptimisticLockConflict(updErr, updRes)) {
        throw updErr || new Error(`ไม่สามารถอัปเดตข้อมูล ${table} ได้`);
      }
      if (attempt === 3) {
        throw new Error('บันทึกไม่สำเร็จ เนื่องจากมีการแก้ไขข้อมูลพร้อมกันเกินจำนวนครั้งที่กำหนด');
      }

      const { row: freshAfterConflict, error: conflictErr } = await readRow();
      if (conflictErr) throw conflictErr;
      if (!freshAfterConflict?.id) throw new Error('ไม่พบรายการที่แก้ไขได้ กรุณาโหลดข้อมูลใหม่');

      validateAndFilter(freshAfterConflict, true);

      const isLeadContractReassigned = Boolean(
        guard.contractId && table === 'leads' &&
        freshAfterConflict.active_rental_contract_id && freshAfterConflict.active_rental_contract_id !== guard.contractId
      );
      if ((freshAfterConflict.notes || '').trim() === currentNotes && !isLeadContractReassigned) {
        throw new Error('ไม่พบรายการที่แก้ไขได้ หรือสถานะหรือข้อมูลของรายการมีการเปลี่ยนแปลงในระบบ กรุณาโหลดข้อมูลใหม่');
      }
      current = freshAfterConflict;
    }
  };

  const updatePlotIfOwnedByContract = async (
    c: RentalContract,
    opts: {
      buildPatch: (freshPlot: any) => Record<string, unknown> | null;
      allowMissingPlot?: boolean;
      checkCustomerName?: boolean;
      guardLeaseEndDate?: boolean;
      guardSaleStatus?: boolean;
      requireOwnership?: boolean;
      exactCount?: boolean;
      zeroRowError: string;
    }
  ): Promise<PlotUpdateOutcome> => {
    const { data: rawContracts, error: otherErr } = await supabase
      .from('rental_contracts')
      .select('id, status, tenant_name')
      .eq('plot_id', c.plot_id)
      .neq('id', c.id)
      .in('status', ['Active', 'Renewed']);
    if (otherErr) throw otherErr;
    const hasOtherActiveContract = (Array.isArray(rawContracts) ? rawContracts : []).some(
      (rc: any) => rc && rc.id && rc.id !== c.id && ['Active', 'Renewed'].includes(rc.status)
    );
    if (hasOtherActiveContract) {
      if (opts.requireOwnership) {
        throw new Error(opts.zeroRowError);
      }
      return 'kept_for_other_holder';
    }

    const { data: rawPlot, error: plotErr } = await supabase
      .from('plots')
      .select('id, sale_status, has_customer, current_tenant_name, customer_name, lease_end_date, monthly_rent')
      .eq('id', c.plot_id)
      .maybeSingle();
    if (plotErr) throw plotErr;
    const freshPlot = unwrapRow(rawPlot);
    if (!freshPlot) {
      if (opts.allowMissingPlot) return 'already_satisfied';
      throw new Error('ไม่พบข้อมูลแปลงที่ระบุ');
    }

    const pTenant = cleanName(freshPlot.current_tenant_name);
    const pCust = cleanName(freshPlot.customer_name);
    const cTenant = cleanName(c.tenant_name);
    if ((pTenant && cTenant && pTenant !== cTenant) || (opts.checkCustomerName && pCust && cTenant && pCust !== cTenant && freshPlot.sale_status !== 'Available')) {
      if (opts.requireOwnership) {
        throw new Error(opts.zeroRowError);
      }
      return 'kept_for_other_holder';
    }

    const patch = opts.buildPatch(freshPlot);
    if (!patch) return 'already_satisfied';

    let upd = opts.exactCount
      ? supabase.from('plots').update(patch, { count: 'exact' }).eq('id', c.plot_id)
      : supabase.from('plots').update(patch).eq('id', c.plot_id);
    if (opts.guardSaleStatus && freshPlot.sale_status) {
      upd = upd.eq('sale_status', freshPlot.sale_status);
    }
    if (opts.guardLeaseEndDate && freshPlot.lease_end_date) {
      upd = upd.eq('lease_end_date', freshPlot.lease_end_date);
    }
    if (freshPlot.current_tenant_name) {
      upd = upd.eq('current_tenant_name', freshPlot.current_tenant_name);
    }

    const updRes: any = await selectMaybeSingleId(upd);
    ensureRowUpdated(updRes, opts.zeroRowError);
    return 'updated';
  };

  type SaleReconcileDecision =
    | { action: 'reconciled_success'; saleId: string }
    | { action: 'needs_update'; targetSale: any }
    | { action: 'needs_insert' }
    | { action: 'conflict'; message: string };

  const matchesInitialSaleSnapshot = (sale: any, snap: InitialSaleSnapshot): boolean => {
    if (!sale || sale.id !== snap.saleId) return false;
    if (snap.contractStatus !== undefined && sale.contract_status !== snap.contractStatus) return false;
    if (snap.crmStage !== undefined && sale.crm_stage !== snap.crmStage) return false;
    if (snap.salePrice !== undefined && sale.sale_price !== undefined && Number(sale.sale_price) !== Number(snap.salePrice)) return false;
    if (snap.bookedAt !== undefined && sale.booked_at !== undefined && !sameSaleTimestamp(sale.booked_at, snap.bookedAt)) return false;
    if (snap.updatedAt !== undefined) {
      if (sale.updated_at !== undefined && !sameSaleTimestamp(sale.updated_at, snap.updatedAt)) return false;
    } else if (sale.updated_at) {
      return false;
    }
    return true;
  };

  const evaluateSaleStateForConvert = (
    sale: any | null,
    snap: InitialSaleSnapshot,
    attempt?: SaleWriteAttempt
  ): SaleReconcileDecision => {
    if (snap.hadExistingSale) {
      if (!sale || sale.id !== snap.saleId) {
        return {
          action: 'conflict',
          message: 'ไม่สามารถอัปเดตรายการขายได้ เนื่องจากรายการขายเดิมถูกยกเลิกหรือเปลี่ยนแปลงระหว่างทำรายการ'
        };
      }
      if (sale.contract_status === 'Transferred' || salesDealStageOf(sale) === 'transferred') {
        return {
          action: 'conflict',
          message: 'รายการขายนี้ถูกโอนกรรมสิทธิ์แล้ว ไม่สามารถดำเนินการได้'
        };
      }

      if (
        attempt &&
        (attempt.status === 'unknown_or_lost_response' || attempt.status === 'confirmed_success') &&
        attempt.mode === 'update' &&
        attempt.targetSaleId === sale.id
      ) {
        const wp = attempt.writtenPayload;
        const statusMatchesWritten =
          sale.contract_status === wp.contractStatus && sale.crm_stage === wp.crmStage;
        const priceMatchesWritten =
          sale.sale_price !== undefined && Number(sale.sale_price) === Number(wp.salePrice);
        const bookedAtMatchesWritten =
          sameSaleTimestamp(sale.booked_at, wp.bookedAt);
        const wasMutatedFromInitial =
          (wp.updatedAt !== undefined && sameSaleTimestamp(sale.updated_at, wp.updatedAt)) ||
          (snap.updatedAt !== undefined && sale.updated_at !== undefined && !sameSaleTimestamp(sale.updated_at, snap.updatedAt)) ||
          (snap.salePrice !== undefined && sale.sale_price !== undefined && Number(sale.sale_price) !== Number(snap.salePrice)) ||
          (snap.bookedAt !== undefined && sale.booked_at !== undefined && !sameSaleTimestamp(sale.booked_at, snap.bookedAt));

        if (statusMatchesWritten && priceMatchesWritten && bookedAtMatchesWritten && wasMutatedFromInitial) {
          return { action: 'reconciled_success', saleId: sale.id };
        }
        if (matchesInitialSaleSnapshot(sale, snap)) {
          return salesDealStageOf(sale) === 'booked'
            ? { action: 'needs_update', targetSale: sale }
            : { action: 'reconciled_success', saleId: sale.id };
        }
        if (!statusMatchesWritten) {
          return {
            action: 'conflict',
            message: 'ไม่สามารถอัปเดตรายการขายได้ เนื่องจากสถานะรายการขายมีการเปลี่ยนแปลงระหว่างทำรายการ'
          };
        }
        if (!priceMatchesWritten) {
          return {
            action: 'conflict',
            message: 'ไม่สามารถอัปเดตรายการขายได้ เนื่องจากราคาขายมีการเปลี่ยนแปลงระหว่างทำรายการ'
          };
        }
        return {
          action: 'conflict',
          message: 'ไม่สามารถอัปเดตรายการขายได้ เนื่องจากข้อมูลรายการขายมีการเปลี่ยนแปลงระหว่างทำรายการ'
        };
      }

      if (
        (snap.contractStatus !== undefined && sale.contract_status !== snap.contractStatus) ||
        (snap.crmStage !== undefined && sale.crm_stage !== snap.crmStage)
      ) {
        return {
          action: 'conflict',
          message: 'ไม่สามารถอัปเดตรายการขายได้ เนื่องจากสถานะรายการขายมีการเปลี่ยนแปลงระหว่างทำรายการ'
        };
      }
      if (
        snap.salePrice !== undefined &&
        sale.sale_price !== undefined &&
        Number(sale.sale_price) !== Number(snap.salePrice)
      ) {
        return {
          action: 'conflict',
          message: 'ไม่สามารถอัปเดตรายการขายได้ เนื่องจากราคาขายมีการเปลี่ยนแปลงระหว่างทำรายการ'
        };
      }
      if (
        snap.bookedAt !== undefined &&
        sale.booked_at !== undefined &&
        !sameSaleTimestamp(sale.booked_at, snap.bookedAt)
      ) {
        return {
          action: 'conflict',
          message: 'ไม่สามารถอัปเดตรายการขายได้ เนื่องจากข้อมูลรายการขายมีการเปลี่ยนแปลงระหว่างทำรายการ'
        };
      }
      if (
        snap.updatedAt !== undefined &&
        sale.updated_at !== undefined &&
        !sameSaleTimestamp(sale.updated_at, snap.updatedAt)
      ) {
        return {
          action: 'conflict',
          message: 'ไม่สามารถอัปเดตรายการขายได้ เนื่องจากข้อมูลรายการขายมีการเปลี่ยนแปลงระหว่างทำรายการ'
        };
      }
      return salesDealStageOf(sale) === 'booked'
        ? { action: 'needs_update', targetSale: sale }
        : { action: 'reconciled_success', saleId: sale.id };
    }

    // snap.hadExistingSale === false
    if (!sale) {
      return { action: 'needs_insert' };
    }
    if (sale.contract_status === 'Transferred' || salesDealStageOf(sale) === 'transferred') {
      return {
        action: 'conflict',
        message: 'รายการขายนี้ถูกโอนกรรมสิทธิ์แล้ว ไม่สามารถดำเนินการได้'
      };
    }

    if (
      !attempt ||
      attempt.mode !== 'insert' ||
      attempt.status === 'not_sent' ||
      attempt.status === 'failed_before_commit'
    ) {
      return {
        action: 'conflict',
        message: 'พบรายการขายที่ถูกสร้างขึ้นใหม่ระหว่างทำรายการ ไม่สามารถเขียนทับรายการขายได้ กรุณาตรวจสอบข้อมูลล่าสุด'
      };
    }

    const wp = attempt.writtenPayload;
    if (sale.contract_status !== wp.contractStatus || sale.crm_stage !== wp.crmStage) {
      return {
        action: 'conflict',
        message: 'ไม่สามารถอัปเดตรายการขายได้ เนื่องจากสถานะรายการขายมีการเปลี่ยนแปลงระหว่างทำรายการ'
      };
    }
    if (sale.sale_price === undefined || Number(sale.sale_price) !== Number(wp.salePrice)) {
      return {
        action: 'conflict',
        message: 'ไม่สามารถอัปเดตรายการขายได้ เนื่องจากราคาขายมีการเปลี่ยนแปลงระหว่างทำรายการ'
      };
    }
    if (!sameSaleTimestamp(sale.booked_at, wp.bookedAt)) {
      return {
        action: 'conflict',
        message: 'ไม่สามารถอัปเดตรายการขายได้ เนื่องจากข้อมูลรายการขายมีการเปลี่ยนแปลงระหว่างทำรายการ'
      };
    }
    if (!attempt.targetSaleId || sale.id !== attempt.targetSaleId) {
      return {
        action: 'conflict',
        message: 'พบรายการขายที่ถูกสร้างขึ้นใหม่ระหว่างทำรายการ ไม่สามารถยืนยันได้ว่าเป็นรายการเดียวกัน กรุณาตรวจสอบข้อมูลล่าสุด'
      };
    }
    return { action: 'reconciled_success', saleId: sale.id };
  };

  const runAction = async (kind: string, steps: (() => Promise<void>)[], message: string, initialSaleSnapshot?: InitialSaleSnapshot) => {
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
    const plotLabel = String(activeContract.plot_name || activeContract.plot_id || '');
    if (actionProgress.current) {
      if (actionProgress.current.completed === 0) {
        actionProgress.current.steps = steps;
        actionProgress.current.message = message;
      }
      if (!actionProgress.current.plotLabel) {
        actionProgress.current.plotLabel = plotLabel;
      }
      if (initialSaleSnapshot && !actionProgress.current.initialSaleSnapshot) {
        actionProgress.current.initialSaleSnapshot = initialSaleSnapshot;
      }
    }
    const progress = actionProgress.current || { kind, completed: 0, steps, message, plotLabel, initialSaleSnapshot };
    actionProgress.current = progress;
    try {
      while (progress.completed < progress.steps.length) {
        if (!isMounted.current || requestScope !== currentScope.current) return;
        await progress.steps[progress.completed]();
        progress.completed++;
      }
      if (!isMounted.current || requestScope !== currentScope.current) return;
      const finalMessage =
        progress.kind === 'move_out' && progress.plotOutcome
          ? progress.plotOutcome === 'kept_for_other_holder'
            ? '📦 บันทึกสิ้นสุดสัญญาเช่าเดิมเรียบร้อยแล้ว (แปลง ' + (progress.plotLabel || plotLabel) + ' ยังคงสถานะปัจจุบันเนื่องจากมีสัญญาหรือผู้ถือสิทธิ์อื่นอยู่)'
            : progress.plotOutcome === 'already_satisfied'
              ? '📦 สิ้นสุดสัญญาเรียบร้อย! แปลง ' + (progress.plotLabel || plotLabel) + ' เป็นแปลงว่างพร้อมขาย/เช่าอยู่แล้ว'
              : '📦 สิ้นสุดสัญญาเรียบร้อย! ปลดแปลง ' + (progress.plotLabel || plotLabel) + ' กลับมาเป็นแปลงว่างพร้อมขาย/เช่าแล้ว'
          : progress.message;
      actionProgress.current = null;
      if (typeof window !== 'undefined') {
        broadcastSalesSync({ type: kind, timestamp: Date.now() });
      }
      if (isMounted.current && requestScope === currentScope.current) {
        onSaved?.();
        onClose();
        alert(finalMessage);
      }
    } catch (error) {
      if (isMounted.current && requestScope === currentScope.current) {
        const detail = error instanceof Error ? error.message : (error as { message?: string })?.message || 'บันทึกไม่สำเร็จ';
        if (progress.completed === 0 && !progress.saleWriteAttempt) actionProgress.current = null;
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
    if (busy.current || convertBusy.current || submitting || loading || !activeContract || !isMounted.current) return;
    const c = activeContract;
    if (!c.lead_id) { setErrorMsg('ต้องเชื่อมสัญญาเช่ากับ Lead ก่อนเปลี่ยนเป็นซื้อ เพื่อเก็บประวัติลูกค้าคนเดิม'); return; }

    const requestScope = currentScope.current;
    convertBusy.current = true;
    setSubmitting(true);
    setErrorMsg(null);

    try {
      const finalPrice = parseFloat(customPurchasePrice) || conversionInfo?.finalPurchasePrice || 0;
      const bookingCredit = parseFloat(appliedBookingCredit) || 0;
      const formatPreflightError = (msg: string) =>
        actionProgress.current && actionProgress.current.kind === 'convert_to_buy' && actionProgress.current.completed > 0
          ? 'บันทึกบางส่วนแล้ว แต่ยังไม่ครบ: ' + msg
          : msg;

      // Fetch fresh state of sales, plots, leads, and competing contracts BEFORE committing steps
      const { data: existingSales, error: selectErr } = await supabase.from('sales')
        .select('id, contract_status, crm_stage, sale_price, booked_at, created_at, updated_at')
        .eq('lead_id', c.lead_id)
        .eq('plot_id', c.plot_id)
        .neq('contract_status', 'Cancelled');

      if (!isMounted.current || requestScope !== currentScope.current) return;
      if (selectErr) {
        setErrorMsg(formatPreflightError('ตรวจสอบรายการขายไม่สำเร็จ: ' + selectErr.message));
        return;
      }

      const { data: rawLead, error: leadErr } = await supabase.from('leads')
        .select('id, status, rental_status, notes, customer_name, active_rental_contract_id')
        .eq('id', c.lead_id)
        .maybeSingle();

      if (!isMounted.current || requestScope !== currentScope.current) return;
      if (leadErr) {
        setErrorMsg(formatPreflightError('ตรวจสอบข้อมูลลูกค้าไม่สำเร็จ: ' + leadErr.message));
        return;
      }
      const freshLead = unwrapRow(rawLead);
      if (freshLead?.status === 'Cancelled' || freshLead?.status === 'Lost') {
        setErrorMsg(formatPreflightError('สถานะของลูกค้าถูกยกเลิกแล้ว ไม่สามารถดำเนินการได้'));
        return;
      }

      const { data: rawPlot, error: plotErr } = await supabase.from('plots')
        .select('id, sale_status, has_customer, current_tenant_name, customer_name, lease_end_date')
        .eq('id', c.plot_id)
        .maybeSingle();

      if (!isMounted.current || requestScope !== currentScope.current) return;
      if (plotErr) {
        setErrorMsg(formatPreflightError('ตรวจสอบข้อมูลแปลงไม่สำเร็จ: ' + plotErr.message));
        return;
      }
      const freshPlot = unwrapRow(rawPlot);

      if (!freshPlot) {
        setErrorMsg(formatPreflightError('ไม่พบข้อมูลแปลงที่เกี่ยวข้อง'));
        return;
      }
      if (freshPlot.sale_status === 'Transferred') {
        setErrorMsg(formatPreflightError('แปลงนี้ถูกโอนกรรมสิทธิ์แล้ว ไม่สามารถดำเนินการได้'));
        return;
      }
      const cTenantClean = cleanName(c.tenant_name || freshLead?.customer_name);
      const plotTenantClean = cleanName(freshPlot.current_tenant_name);
      const plotCustClean = cleanName(freshPlot.customer_name);

      if (plotTenantClean && cTenantClean && plotTenantClean !== cTenantClean) {
        setErrorMsg(formatPreflightError(`แปลงนี้มีผู้เช่าอื่นถือสิทธิ์อยู่ (${freshPlot.current_tenant_name}) ไม่สามารถเปลี่ยนเป็นซื้อได้`));
        return;
      }
      if (plotCustClean && cTenantClean && plotCustClean !== cTenantClean && freshPlot.sale_status !== 'Available') {
        setErrorMsg(formatPreflightError(`แปลงนี้ไม่ได้ถูกผูกสิทธิ์กับลูกค้ารายนี้ (ผู้ถือสิทธิ์ปัจจุบัน: ${freshPlot.customer_name})`));
        return;
      }

      const { data: rawOtherContracts, error: otherContractsErr } = await supabase
        .from('rental_contracts')
        .select('id, status, tenant_name, lead_id')
        .eq('plot_id', c.plot_id)
        .neq('id', c.id)
        .in('status', ['Active', 'Renewed']);

      if (!isMounted.current || requestScope !== currentScope.current) return;
      if (otherContractsErr) {
        setErrorMsg(formatPreflightError('ตรวจสอบสัญญาเช่าบนแปลงไม่สำเร็จ: ' + otherContractsErr.message));
        return;
      }
      const conflictingContract = (Array.isArray(rawOtherContracts) ? rawOtherContracts : []).find(
        (rc: any) => rc && rc.id && rc.id !== c.id && ['Active', 'Renewed'].includes(rc.status)
      );
      if (conflictingContract) {
        const otherTenantClean = cleanName(conflictingContract.tenant_name);
        if (otherTenantClean && cTenantClean && otherTenantClean !== cTenantClean) {
          setErrorMsg(formatPreflightError(`แปลงนี้มีผู้เช่าอื่นถือสิทธิ์อยู่ (${conflictingContract.tenant_name || freshPlot.current_tenant_name}) ไม่สามารถเปลี่ยนเป็นซื้อได้`));
        } else {
          setErrorMsg(formatPreflightError('สัญญานี้ไม่ใช่สัญญาเช่าปัจจุบันที่ถือสิทธิ์แปลงนี้ (มีสัญญาเช่าอื่นที่ยังมีผลอยู่) ไม่สามารถเปลี่ยนเป็นซื้อได้'));
        }
        return;
      }

      if (freshLead?.active_rental_contract_id && freshLead.active_rental_contract_id !== c.id) {
        setErrorMsg(formatPreflightError('สัญญานี้ไม่ใช่สัญญาเช่าปัจจุบันที่ผูกกับลูกค้า (มีสัญญาเช่าอื่นถือสิทธิ์อยู่) ไม่สามารถเปลี่ยนเป็นซื้อได้'));
        return;
      }

      if (existingSales && existingSales.length > 1) {
        setErrorMsg(formatPreflightError('พบรายการขายมากกว่า 1 รายการ กรุณาตรวจสอบข้อมูล'));
        return;
      }

      const preflightSale = (existingSales && existingSales.length === 1) ? existingSales[0] : null;
      if (preflightSale && (preflightSale.contract_status === 'Transferred' || salesDealStageOf(preflightSale) === 'transferred')) {
        setErrorMsg(formatPreflightError('รายการขายนี้ถูกโอนกรรมสิทธิ์แล้ว ไม่สามารถดำเนินการได้'));
        return;
      }

      const priorSaleSnapshot = actionProgress.current?.kind === 'convert_to_buy'
        ? actionProgress.current.initialSaleSnapshot
        : undefined;
      const priorSaleAttempt = actionProgress.current?.kind === 'convert_to_buy'
        ? actionProgress.current.saleWriteAttempt
        : undefined;
      const hasCancelledAttemptRow = async (attempt?: SaleWriteAttempt): Promise<boolean> => {
        if (!attempt || attempt.mode !== 'insert') return false;
        if (attempt.status !== 'unknown_or_lost_response' && attempt.status !== 'confirmed_success') return false;
        if (!attempt.targetSaleId) {
          throw new Error('ไม่สามารถยืนยันรายการขายจากคำสั่งเดิมได้ กรุณาตรวจสอบข้อมูลล่าสุด');
        }
        const { data: cancelledRows, error: cancelledError } = await supabase.from('sales')
          .select('id, contract_status')
          .eq('id', attempt.targetSaleId)
          .eq('lead_id', c.lead_id)
          .eq('plot_id', c.plot_id)
          .eq('contract_status', 'Cancelled');
        if (cancelledError) {
          throw new Error('ตรวจสอบรายการขายที่ถูกยกเลิกไม่สำเร็จ: ' + cancelledError.message);
        }
        if (!Array.isArray(cancelledRows)) {
          throw new Error('ไม่สามารถยืนยันผลตรวจสอบรายการขายที่ถูกยกเลิกได้');
        }
        return cancelledRows.some(row => row.id === attempt.targetSaleId && row.contract_status === 'Cancelled');
      };
      if (priorSaleSnapshot) {
        if (!priorSaleSnapshot.hadExistingSale && !preflightSale && await hasCancelledAttemptRow(priorSaleAttempt)) {
          setErrorMsg(formatPreflightError('ไม่สามารถอัปเดตรายการขายได้ เนื่องจากรายการขายถูกยกเลิกระหว่างทำรายการ'));
          return;
        }
        const preflightDecision = evaluateSaleStateForConvert(preflightSale, priorSaleSnapshot, priorSaleAttempt);
        if (preflightDecision.action === 'conflict') {
          setErrorMsg(formatPreflightError(preflightDecision.message));
          return;
        }
      }

      const initialSaleSnapshot: InitialSaleSnapshot = priorSaleSnapshot || {
        hadExistingSale: Boolean(preflightSale),
        saleId: preflightSale?.id ?? null,
        contractStatus: preflightSale?.contract_status,
        crmStage: preflightSale?.crm_stage,
        salePrice: preflightSale?.sale_price,
        bookedAt: preflightSale?.booked_at,
        updatedAt: preflightSale?.updated_at,
      };

      const resumesPreparedSteps = actionProgress.current?.kind === 'convert_to_buy'
        && actionProgress.current.completed > 0;
      const preparedInsertSaleId = initialSaleSnapshot.hadExistingSale || resumesPreparedSteps
        ? undefined
        : priorSaleAttempt?.mode === 'insert' && priorSaleAttempt.targetSaleId
          ? priorSaleAttempt.targetSaleId
          : createSaleId();
      const steps: (() => Promise<void>)[] = [];

      // 1. Contract update (fresh read + optimistic lock notes merge)
      const convertContractLog = 'เปลี่ยนจากเช่าเป็นซื้อเมื่อ ' + purchaseDate + ' (หักเครดิต/เงินสะสม ' + bookingCredit.toLocaleString() + ' บาท)';
      if (c.status !== 'ConvertedToBuy') {
        steps.push(() => updateRowWithNotes('rental_contracts', c.id, {
          status: 'ConvertedToBuy', conversion_date: purchaseDate
        }, convertContractLog, undefined, { expectedStatus: c.status, allowedStatuses: ['Active', 'Renewed'], actionKind: 'convert_to_buy' }));
      }

      // 2. Plot update: Evaluate latestPlot inside helper; do NOT downgrade if already advanced; reject if Transferred
      steps.push(async () => {
        await updatePlotIfOwnedByContract(c, {
          requireOwnership: true,
          checkCustomerName: true,
          guardSaleStatus: true,
          guardLeaseEndDate: true,
          buildPatch: (latestPlot) => {
            if (latestPlot.sale_status === 'Transferred' || salesDealStageOf({ status: latestPlot.sale_status }) === 'transferred') {
              throw new Error('แปลงนี้ถูกโอนกรรมสิทธิ์แล้ว ไม่สามารถดำเนินการได้');
            }
            const latestPlotStage = salesDealStageOf({ status: latestPlot.sale_status });
            const latestIsPlotAdvanced = latestPlotStage !== 'booked' && latestPlotStage !== 'cancelled';
            return latestIsPlotAdvanced
              ? {
                  current_tenant_name: null, current_tenant_phone: null, rental_program: null,
                  monthly_rent: null, security_deposit: null, lease_start_date: null, lease_end_date: null
                }
              : {
                  sale_status: 'Reserved', has_customer: true, current_tenant_name: null,
                  current_tenant_phone: null, rental_program: null, highlight_note: 'จองซื้อ (เปลี่ยนจากเช่า ' + programMeta.name + ')'
                };
          },
          zeroRowError: 'ไม่สามารถอัปเดตแปลงได้ เนื่องจากข้อมูลแปลงมีการเปลี่ยนแปลงหรือไม่มีสิทธิ์'
        });
      });

      // 3. Lead update: Re-validate fresh lead state & contract linkage; do NOT downgrade if already advanced
      if (c.lead_id) {
        const convertLeadLog = `[เปลี่ยนจากเช่าเป็นซื้อ ${purchaseDate}]: ยอดหักสะสม ${bookingCredit.toLocaleString()} บ. ราคาขายสุทธิ ${finalPrice.toLocaleString()} บ.`;
        steps.push(async () => {
          const { data: rawLatestLead, error: latestLeadErr } = await supabase.from('leads')
            .select('id, status, rental_status, notes, active_rental_contract_id')
            .eq('id', c.lead_id!)
            .maybeSingle();
          if (latestLeadErr) {
            throw new Error('ไม่สามารถอ่านโน้ตล่าสุดของลูกค้าได้: ' + latestLeadErr.message);
          }
          const latestLead = unwrapRow(rawLatestLead);
          if (!latestLead?.id) {
            throw new Error('ไม่พบรายการที่แก้ไขได้ กรุณาโหลดข้อมูลใหม่');
          }
          if (latestLead.status === 'Cancelled' || latestLead.status === 'Lost') {
            throw new Error('สถานะของลูกค้าถูกยกเลิกแล้ว ไม่สามารถดำเนินการได้');
          }
          if (latestLead.active_rental_contract_id && latestLead.active_rental_contract_id !== c.id) {
            throw new Error('สัญญานี้ไม่ใช่สัญญาเช่าปัจจุบันที่ผูกกับลูกค้า (มีสัญญาเช่าอื่นถือสิทธิ์อยู่) ไม่สามารถเปลี่ยนเป็นซื้อได้');
          }
          const latestLeadStage = salesDealStageOf(latestLead);
          const latestIsLeadAdvanced = latestLeadStage !== 'booked' && latestLeadStage !== 'cancelled';
          if (latestIsLeadAdvanced) {
            let updLead = supabase.from('leads').update({
              deal_type: 'buy',
              rental_status: 'ConvertedToBuy'
            }).eq('id', c.lead_id!);
            if (latestLead.status) {
              updLead = updLead.eq('status', latestLead.status);
            }
            if ('active_rental_contract_id' in latestLead) {
              if (latestLead.active_rental_contract_id === null) {
                updLead = updLead.is('active_rental_contract_id', null);
              } else if (typeof latestLead.active_rental_contract_id === 'string') {
                updLead = updLead.eq('active_rental_contract_id', latestLead.active_rental_contract_id);
              }
            }
            const updLeadRes: any = await selectMaybeSingleId(updLead);
            const hasZeroRow = updLeadRes?.count === 0 || (Array.isArray(updLeadRes?.data) && updLeadRes.data.length === 0) || !unwrapRow(updLeadRes?.data)?.id;
            if (isZeroRowPostgrestError(updLeadRes?.error) || (!updLeadRes?.error && hasZeroRow)) {
              const { data: rawAfter } = await supabase.from('leads')
                .select('id, status, active_rental_contract_id')
                .eq('id', c.lead_id!)
                .maybeSingle();
              const afterLead = unwrapRow(rawAfter);
              if (afterLead?.status === 'Cancelled' || afterLead?.status === 'Lost') {
                throw new Error('สถานะของลูกค้าถูกยกเลิกแล้ว ไม่สามารถดำเนินการได้');
              }
              if (afterLead?.active_rental_contract_id && afterLead.active_rental_contract_id !== c.id) {
                throw new Error('สัญญานี้ไม่ใช่สัญญาเช่าปัจจุบันที่ผูกกับลูกค้า (มีสัญญาเช่าอื่นถือสิทธิ์อยู่) ไม่สามารถเปลี่ยนเป็นซื้อได้');
              }
            }
            ensureRowUpdated(updLeadRes, 'สัญญานี้ไม่ใช่สัญญาเช่าปัจจุบันที่ผูกกับลูกค้า หรือสถานะของลูกค้ามีการเปลี่ยนแปลงระหว่างทำรายการ');
          } else {
            await updateRowWithNotes('leads', c.lead_id!, {
              deal_type: 'buy', status: 'Booked', crm_status: 'Booked — จองแล้ว',
              booking_date: purchaseDate, booking_amount: bookingCredit,
              rental_status: 'ConvertedToBuy'
            }, convertLeadLog, undefined, { allowedStatuses: ['Rented', 'Active', 'Follow Up', 'Contacted', 'Interested', 'New Lead', 'PendingContract', 'Renewed', 'Booked', 'Reserved', 'Survey', 'New'], contractId: c.id, actionKind: 'convert_to_buy' });
          }
        });

        // 4. Sales update/insert: Fresh query + write-attempt tracking + conditional guards to guarantee idempotency and prevent overwriting concurrent sales edits
        steps.push(async () => {
          const { data: activePlotContracts, error: plotHoldErr } = await supabase
            .from('rental_contracts')
            .select('id, status')
            .eq('plot_id', c.plot_id)
            .neq('id', c.id)
            .in('status', ['Active', 'Renewed']);
          if (plotHoldErr) throw plotHoldErr;
          if ((Array.isArray(activePlotContracts) ? activePlotContracts : []).some((rc: any) => rc && rc.id && rc.id !== c.id && ['Active', 'Renewed'].includes(rc.status))) {
            throw new Error('สัญญานี้ไม่ใช่สัญญาเช่าปัจจุบันที่ถือสิทธิ์แปลงนี้ (มีสัญญาเช่าอื่นที่ยังมีผลอยู่) ไม่สามารถเปลี่ยนเป็นซื้อได้');
          }

          const { data: currentSales, error: checkErr } = await supabase.from('sales')
            .select('id, contract_status, crm_stage, sale_price, booked_at, created_at, updated_at')
            .eq('lead_id', c.lead_id)
            .eq('plot_id', c.plot_id)
            .neq('contract_status', 'Cancelled');

          if (checkErr) throw checkErr;
          if (currentSales && currentSales.length > 1) {
            throw new Error('พบรายการขายมากกว่า 1 รายการ กรุณาตรวจสอบข้อมูล');
          }
          const targetSale = (currentSales && currentSales.length > 0) ? currentSales[0] : null;
          const snap = actionProgress.current?.initialSaleSnapshot || initialSaleSnapshot;
          const attempt = actionProgress.current?.saleWriteAttempt;

          if (!snap.hadExistingSale && !targetSale && await hasCancelledAttemptRow(attempt)) {
            throw new Error('ไม่สามารถอัปเดตรายการขายได้ เนื่องจากรายการขายถูกยกเลิกระหว่างทำรายการ');
          }

          const decision = evaluateSaleStateForConvert(targetSale, snap, attempt);
          if (decision.action === 'conflict') {
            throw new Error(decision.message);
          }
          if (decision.action === 'reconciled_success') {
            if (actionProgress.current && actionProgress.current.saleWriteAttempt) {
              actionProgress.current.saleWriteAttempt.status = 'confirmed_success';
              actionProgress.current.saleWriteAttempt.targetSaleId = decision.saleId;
            }
            return;
          }

          const writtenBookedAt = purchaseDate + 'T12:00:00Z';
          const isPreCommitZeroRowFailure = (res: any) => {
            if (res?.error) return isZeroRowPostgrestError(res.error);
            const row = unwrapRow(res?.data);
            return res?.count === 0 || (Array.isArray(res?.data) && res.data.length === 0) || !row?.id;
          };

          if (decision.action === 'needs_update') {
            const saleToUpdate = decision.targetSale;
            const writtenUpdatedAt = new Date().toISOString();
            if (actionProgress.current) {
              actionProgress.current.saleWriteAttempt = {
                status: 'unknown_or_lost_response',
                mode: 'update',
                targetSaleId: saleToUpdate.id,
                writtenPayload: {
                  contractStatus: 'Reserved',
                  crmStage: 'booked',
                  salePrice: finalPrice,
                  bookedAt: writtenBookedAt,
                  updatedAt: writtenUpdatedAt
                }
              };
            }
            let updSaleQuery = supabase.from('sales').update({
              contract_status: 'Reserved',
              crm_stage: 'booked',
              sale_price: finalPrice,
              booked_at: writtenBookedAt,
              updated_at: writtenUpdatedAt
            }).eq('id', saleToUpdate.id);
            if ('contract_status' in saleToUpdate && saleToUpdate.contract_status !== undefined) {
              updSaleQuery = saleToUpdate.contract_status === null
                ? updSaleQuery.is('contract_status', null)
                : updSaleQuery.eq('contract_status', saleToUpdate.contract_status);
            }
            if ('crm_stage' in saleToUpdate && saleToUpdate.crm_stage !== undefined) {
              updSaleQuery = saleToUpdate.crm_stage === null
                ? updSaleQuery.is('crm_stage', null)
                : updSaleQuery.eq('crm_stage', saleToUpdate.crm_stage);
            }
            if ('sale_price' in saleToUpdate && saleToUpdate.sale_price !== undefined) {
              updSaleQuery = saleToUpdate.sale_price === null
                ? updSaleQuery.is('sale_price', null)
                : updSaleQuery.eq('sale_price', saleToUpdate.sale_price);
            }
            if ('updated_at' in saleToUpdate && saleToUpdate.updated_at !== undefined) {
              updSaleQuery = saleToUpdate.updated_at === null
                ? updSaleQuery.is('updated_at', null)
                : updSaleQuery.eq('updated_at', saleToUpdate.updated_at);
            }
            if ('booked_at' in saleToUpdate && saleToUpdate.booked_at !== undefined) {
              updSaleQuery = saleToUpdate.booked_at === null
                ? updSaleQuery.is('booked_at', null)
                : updSaleQuery.eq('booked_at', saleToUpdate.booked_at);
            }
            const updSaleRes = await selectMaybeSingleId(updSaleQuery);
            if (isPreCommitZeroRowFailure(updSaleRes) && actionProgress.current?.saleWriteAttempt) {
              actionProgress.current.saleWriteAttempt.status = 'failed_before_commit';
            }
            const updatedSaleRow = ensureRowUpdated(updSaleRes, 'ไม่สามารถอัปเดตรายการขายได้ เนื่องจากข้อมูลมีการเปลี่ยนแปลงระหว่างทำรายการ');
            if (actionProgress.current?.saleWriteAttempt) {
              actionProgress.current.saleWriteAttempt.status = 'confirmed_success';
              actionProgress.current.saleWriteAttempt.targetSaleId = updatedSaleRow.id;
            }
          } else {
            const writtenCreatedAt = new Date().toISOString();
            const insertSaleId = attempt?.mode === 'insert' && attempt.targetSaleId
              ? attempt.targetSaleId
              : preparedInsertSaleId;
            if (!insertSaleId) {
              throw new Error('ไม่สามารถยืนยันรหัสรายการขายที่เตรียมไว้ได้ กรุณาตรวจสอบข้อมูลล่าสุด');
            }
            if (actionProgress.current) {
              actionProgress.current.saleWriteAttempt = {
                status: 'unknown_or_lost_response',
                mode: 'insert',
                targetSaleId: insertSaleId,
                writtenPayload: {
                  contractStatus: 'Reserved',
                  crmStage: 'booked',
                  salePrice: finalPrice,
                  bookedAt: writtenBookedAt,
                  createdAt: writtenCreatedAt
                }
              };
            }
            const insSaleQuery = supabase.from('sales').insert([{
              id: insertSaleId,
              lead_id: c.lead_id, plot_id: c.plot_id, contract_status: 'Reserved',
              crm_stage: 'booked', sale_price: finalPrice, booked_at: writtenBookedAt,
              created_at: writtenCreatedAt
            }]);
            const insSaleRes = await selectMaybeSingleId(insSaleQuery);
            if (isPreCommitZeroRowFailure(insSaleRes) && actionProgress.current?.saleWriteAttempt) {
              actionProgress.current.saleWriteAttempt.status = 'failed_before_commit';
            }
            const insertedSaleRow = ensureRowUpdated(insSaleRes, 'บันทึกรายการขายไม่สำเร็จ');
            if (actionProgress.current?.saleWriteAttempt) {
              actionProgress.current.saleWriteAttempt.status = 'confirmed_success';
              actionProgress.current.saleWriteAttempt.targetSaleId = insertedSaleRow.id;
            }
          }
        });
      }
      if (!isMounted.current || requestScope !== currentScope.current) return;
      await runAction('convert_to_buy', steps, '🎉 เปลี่ยนสถานะสำเร็จ! คุณ ' + c.tenant_name + ' เปลี่ยนเป็นผู้จองซื้อแปลง ' + (c.plot_name || c.plot_id) + ' เรียบร้อยแล้ว', initialSaleSnapshot);
    } catch (error) {
      if (isMounted.current && requestScope === currentScope.current) {
        const detail = error instanceof Error ? error.message : (error as { message?: string })?.message || 'ตรวจสอบรายการขายไม่สำเร็จ';
        setErrorMsg(actionProgress.current && actionProgress.current.completed > 0
          ? 'บันทึกบางส่วนแล้ว แต่ยังไม่ครบ: ' + detail
          : detail);
      }
    } finally {
      convertBusy.current = false;
      if (isMounted.current && requestScope === currentScope.current) {
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
      const moveOutLog = ('ย้ายออกเมื่อ ' + moveOutDate + ' (คืนเงินประกันสุทธิ ' + moveOutRefund.toLocaleString() + ' บาท)').trim();
      steps.push(() => updateRowWithNotes('rental_contracts', c.id, {
        status: 'MovedOut', move_out_date: moveOutDate, deposit_refunded: moveOutRefund
      }, moveOutLog, moveOutNotes, { expectedStatus: c.status, allowedStatuses: ['Active', 'Renewed'], actionKind: 'move_out' }));
    }
    steps.push(async () => {
      const outcome = await updatePlotIfOwnedByContract(c, {
        allowMissingPlot: true,
        checkCustomerName: true,
        guardSaleStatus: true,
        guardLeaseEndDate: true,
        exactCount: true,
        buildPatch: (freshPlot) => {
          if (freshPlot.sale_status && freshPlot.sale_status !== 'Rented' && freshPlot.sale_status !== 'Available') {
            throw new Error('ไม่สามารถคืนแปลงได้ เนื่องจากแปลงนี้ถูกโอนกรรมสิทธิ์หรือเปลี่ยนสถานะการขายแล้ว');
          }
          return (freshPlot.has_customer || freshPlot.sale_status !== 'Available')
            ? {
                sale_status: 'Available', has_customer: false, current_tenant_name: null,
                current_tenant_phone: null, rental_program: null, monthly_rent: null,
                security_deposit: null, lease_start_date: null, lease_end_date: null, highlight_note: null
              }
            : null;
        },
        zeroRowError: 'ไม่สามารถคืนแปลงได้ เนื่องจากข้อมูลแปลงมีการเปลี่ยนแปลงหรือไม่มีสิทธิ์ (0 rows updated)'
      });
      if (actionProgress.current) {
        actionProgress.current.plotOutcome = outcome;
      }
    });

    if (c.lead_id) {
      const moveOutLeadLog = `[สิ้นสุดสัญญาเช่า ย้ายออก ${moveOutDate}]: คืนเงินประกัน ${moveOutRefund.toLocaleString()} บ.`;
      steps.push(() => updateRowWithNotes('leads', c.lead_id!, {
        status: 'MovedOut', crm_status: 'Lease Ended / Moved Out — สิ้นสุดสัญญาเช่า (ย้ายออก)', rental_status: 'MovedOut',
        active_rental_contract_id: null
      }, moveOutLeadLog, moveOutNotes, { allowedStatuses: ['Rented', 'Active', 'Follow Up', 'Contacted', 'Interested', 'New Lead', 'PendingContract', 'Renewed', 'MovedOut', 'Survey', 'New'], contractId: c.id, actionKind: 'move_out' }));
    }
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
    const steps = [
      () => updateRowWithNotes('rental_contracts', c.id, {
        status: 'Renewed', lease_duration_months: (c.lease_duration_months || 12) + renewalMonths,
        lease_end_date: newEndDate, monthly_rent: rentNum
      }, renewalLog, renewalNotes, { expectedStatus: c.status, allowedStatuses: ['Active', 'Renewed'], expectedLeaseEndDate: c.lease_end_date, actionKind: 'renew' }),
      async () => {
        await updatePlotIfOwnedByContract(c, {
          guardSaleStatus: true,
          guardLeaseEndDate: true,
          buildPatch: (freshPlot) => {
            if (freshPlot.sale_status && !['Rented', 'Available'].includes(freshPlot.sale_status)) {
              throw new Error('ไม่สามารถอัปเดตแปลงได้ เนื่องจากสถานะแปลงมีการเปลี่ยนแปลงระหว่างทำรายการ');
            }
            return { monthly_rent: rentNum, lease_end_date: newEndDate };
          },
          zeroRowError: 'ไม่สามารถอัปเดตแปลงได้ เนื่องจากข้อมูลแปลงมีการเปลี่ยนแปลงระหว่างทำรายการ'
        });
      }
    ];
    if (c.lead_id) {
      steps.push(() => updateRowWithNotes('leads', c.lead_id!, {
        rental_status: 'Renewed', rental_end_date: newEndDate, rental_monthly_rent: rentNum
      }, renewalLog, renewalNotes, { allowedStatuses: ['Rented', 'Active', 'Follow Up', 'Contacted', 'Interested', 'New Lead', 'PendingContract', 'Renewed', 'MovedOut', 'Survey', 'New'], contractId: c.id, actionKind: 'renew' }));
    }
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

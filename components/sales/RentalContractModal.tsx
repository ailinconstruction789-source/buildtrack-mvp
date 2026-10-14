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
  Info, 
  Coins, 
  Clock, 
  ArrowRight,
  TrendingDown,
  PiggyBank,
  User,
  Plus
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { canStartSalesDeal, getLeadStage } from '@/lib/sales/leadStage';
import { selectSalesStaffName } from '@/lib/sales/salesStaff';
import { useSalesStaffOptions } from '@/hooks/useSalesStaffOptions';
import { 
  Lead, 
  RentalProgramType, 
  RENTAL_PROGRAM_DETAILS, 
  RentalContract 
} from '@/types/sales';
import { calculateRentalTerms } from '@/lib/rentalHelper';
import LeadPicker from './LeadPicker';
import SalesOverlay from './SalesOverlay';

interface RentalContractModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead?: Lead | null;
  plotId?: string | null;
  projectName?: string;
  user?: any;
  salesOwners?: { userId: string; displayName: string }[];
  onSaved?: () => void;
}

export default function RentalContractModal({
  isOpen,
  onClose,
  lead: initialLead,
  plotId,
  projectName = 'ไอลิน สันทราย 2',
  user,
  salesOwners: providedSalesOwners,
  onSaved
}: RentalContractModalProps) {
  const salesOwners = useSalesStaffOptions(isOpen, providedSalesOwners, String(user?.id ?? user?.username ?? ''));
  const [selectedLead, setSelectedLead] = useState<any | null>(initialLead || null);
  const [isNewLeadMode, setIsNewLeadMode] = useState(false);
  const [selectedProgram, setSelectedProgram] = useState<RentalProgramType>('program_a');
  const [targetProject, setTargetProject] = useState<string>(initialLead?.project_name || projectName);
  const [selectedPlotId, setSelectedPlotId] = useState<string>(plotId || initialLead?.interested_plot_id || '');
  const [plotsList, setPlotsList] = useState<any[]>([]);
  const [loadingPlots, setLoadingPlots] = useState(false);

  // Form Fields
  const [tenantName, setTenantName] = useState<string>(initialLead?.customer_name || '');
  const [tenantPhone, setTenantPhone] = useState<string>(initialLead?.phone || '');
  const [monthlyRent, setMonthlyRent] = useState<string>('15000');
  const [durationMonths, setDurationMonths] = useState<number>(12);
  const [bookingDate, setBookingDate] = useState<string>(() => {
    const raw = initialLead?.booking_date;
    return raw ? String(raw).split('T')[0] : new Date().toISOString().split('T')[0];
  });
  const [bookingAmount, setBookingAmount] = useState<string>(() => {
    const raw = initialLead?.booking_amount;
    return raw !== undefined && raw !== null ? String(raw) : '10000';
  });
  const [contractDate, setContractDate] = useState<string>(() => {
    const raw = initialLead?.contracted_at || initialLead?.contract_date;
    return raw ? String(raw).split('T')[0] : new Date().toISOString().split('T')[0];
  });
  const [startDate, setStartDate] = useState<string>(() => {
    const raw = initialLead?.rental_start_date;
    return raw ? String(raw).split('T')[0] : new Date().toISOString().split('T')[0];
  });
  const [customDeposit, setCustomDeposit] = useState<string>('30000');
  const [depositMonths, setDepositMonths] = useState<number>(2);
  const [hasAdvanceRent, setHasAdvanceRent] = useState<boolean>(true);
  const [advanceRentMonths, setAdvanceRentMonths] = useState<number>(1);
  const [contractFee, setContractFee] = useState<string>('10000');
  const [year4AgreedRent, setYear4AgreedRent] = useState<string>('');
  const [savingsPerMonth, setSavingsPerMonth] = useState<string>('5000');
  const [basePrice, setBasePrice] = useState<string>('2990000');
  const [agentName, setAgentName] = useState<string>('');
  const [ownerSource, setOwnerSource] = useState<'current_user' | 'manual'>('current_user');
  const [notes, setNotes] = useState<string>('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const saveProgress = useRef<{ completed: number; steps: (() => Promise<void>)[] } | null>(null);
  const busy = useRef(false);
  const scope = `${isOpen}:${initialLead?.id || ''}:${plotId || ''}:${user?.id || user?.username || ''}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => {
    saveProgress.current = null;
    busy.current = false;
    setSubmitting(false);
    setErrorMsg(null);
  }, [scope]);


  // Handle lead selection from LeadPicker
  const handleLeadSelect = (chosenLead: any | null) => {
    setSelectedLead(chosenLead);
    if (chosenLead) {
      setTenantName(chosenLead.customer_name || '');
      setTenantPhone(chosenLead.phone || '');
      // Default closer is the logged in user (ID ปัจจุบัน)
      const defaultAgent = selectSalesStaffName(salesOwners, [user?.displayName, user?.username, user?.name]);
      setAgentName(defaultAgent);
      setOwnerSource(defaultAgent && [user?.displayName, user?.username, user?.name].includes(defaultAgent) ? 'current_user' : 'manual');
      if (chosenLead.project_name) {
        setTargetProject(chosenLead.project_name);
      }
      if (chosenLead.interested_plot_id && !plotId) {
        setSelectedPlotId(chosenLead.interested_plot_id);
      }
      if (chosenLead.rental_program) {
        setSelectedProgram(chosenLead.rental_program);
      }
      if (chosenLead.rental_monthly_rent) {
        setMonthlyRent(chosenLead.rental_monthly_rent.toString());
      }
      if (chosenLead.booking_date) {
        setBookingDate(String(chosenLead.booking_date).split('T')[0]);
      }
      if (chosenLead.booking_amount !== undefined && chosenLead.booking_amount !== null) {
        setBookingAmount(chosenLead.booking_amount.toString());
      }
      if (chosenLead.contracted_at || chosenLead.contract_date) {
        setContractDate(String(chosenLead.contracted_at || chosenLead.contract_date).split('T')[0]);
      }
      if (chosenLead.rental_start_date) {
        setStartDate(String(chosenLead.rental_start_date).split('T')[0]);
      }
      setIsNewLeadMode(false);
    } else {
      if (!isNewLeadMode) {
        setTenantName('');
        setTenantPhone('');
      }
    }
  };

  // Sync initial props
  useEffect(() => {
    if (initialLead) {
      handleLeadSelect(initialLead);
    } else {
      const defaultAgent = selectSalesStaffName(salesOwners, [user?.displayName, user?.username, user?.name]);
      setAgentName(defaultAgent);
      setOwnerSource(defaultAgent && [user?.displayName, user?.username, user?.name].includes(defaultAgent) ? 'current_user' : 'manual');
    }
    if (plotId) {
      setSelectedPlotId(plotId);
    }
  }, [initialLead, plotId, user, salesOwners]);

  // Fetch available plots for the selected project & sort naturally
  useEffect(() => {
    if (!isOpen) return;
    let isCancelled = false;
    const fetchPlots = async () => {
      setLoadingPlots(true);
      try {
        const { data, error } = await supabase
          .from('plots')
          .select('*')
          .eq('project_name', targetProject);

        if (error) throw error;
        if (!isCancelled && data) {
          // Sort plots naturally by numeric plot number (e.g. 1, 2, 3... 10, 11)
          const sorted = [...data].sort((a, b) => {
            const nameA = a.plot_name || a.id || '';
            const nameB = b.plot_name || b.id || '';
            return nameA.localeCompare(nameB, 'th', { numeric: true, sensitivity: 'base' });
          });
          setPlotsList(sorted);

          // If no plot selected yet or plot not in this project, pick the first available
          if (!selectedPlotId && sorted.length > 0) {
            const firstVacant = sorted.find(p => !p.has_customer && p.sale_status !== 'Reserved' && p.sale_status !== 'Booked' && p.sale_status !== 'Transferred' && p.sale_status !== 'Rented');
            if (firstVacant) {
              setSelectedPlotId(firstVacant.id);
              const priceVal = firstVacant.selling_price || firstVacant.base_price || firstVacant.price;
              if (priceVal) {
                setBasePrice(priceVal.toString());
              }
              if (firstVacant.monthly_rent) {
                setMonthlyRent(firstVacant.monthly_rent.toString());
              }
            }
          }
        }
      } catch (err) {
        if (!isCancelled) setErrorMsg('โหลดรายการแปลงไม่สำเร็จ กรุณาปิดแล้วเปิดแบบฟอร์มใหม่');
        console.error('Error loading plots for rental modal:', err);
      } finally {
        if (!isCancelled) setLoadingPlots(false);
      }
    };
    fetchPlots();
    return () => { isCancelled = true; };
  }, [isOpen, targetProject]);

  // Filter and naturally sort plots for the dropdown:
  // - Show Available plots (🟢 ว่าง)
  // - Show Booked plots (🟡 ติดจอง)
  // - Keep current customer's plot
  // - Hide Transferred / Rented to someone else
  const availableAndBookedPlots = useMemo(() => {
    return [...plotsList]
      .filter(p => {
        const isMyPlot = p.id === selectedPlotId || p.id === (selectedLead?.interested_plot_id || plotId) || (selectedLead?.customer_name && p.customer_name === selectedLead.customer_name);
        if (isMyPlot) return true;
        // Hide transferred plots
        if (p.sale_status === 'Transferred') return false;
        // Hide plots already occupied/rented to another tenant
        if (p.sale_status === 'Rented' || p.current_tenant_name) return false;
        return true;
      })
      .sort((a, b) => {
        const nameA = a.plot_name || a.id || '';
        const nameB = b.plot_name || b.id || '';
        return nameA.localeCompare(nameB, 'th', { numeric: true, sensitivity: 'base' });
      });
  }, [plotsList, selectedPlotId, selectedLead, plotId]);

  // When plot selection changes, sync plot base price or monthly rent
  const handlePlotChange = (pId: string) => {
    setSelectedPlotId(pId);
    const plot = plotsList.find(p => p.id === pId);
    if (plot) {
      const price = plot.selling_price || plot.base_price || plot.price;
      if (price) setBasePrice(price.toString());
      if (plot.monthly_rent) setMonthlyRent(plot.monthly_rent.toString());
    }
  };

  // Keep deposit in sync with monthly rent and depositMonths
  useEffect(() => {
    const rentNum = parseFloat(monthlyRent) || 0;
    setCustomDeposit((rentNum * depositMonths).toString());
  }, [monthlyRent, depositMonths]);

  // Calculate live financial calculations using helper
  const calcResults = useMemo(() => {
    const rentNum = parseFloat(monthlyRent) || 0;
    const depositNum = parseFloat(customDeposit) || 0;
    const savingsNum = parseFloat(savingsPerMonth) || 0;
    const priceNum = parseFloat(basePrice) || 0;
    const feeNum = parseFloat(contractFee) || 0;
    const year4RentNum = parseFloat(year4AgreedRent);

    return calculateRentalTerms({
      programType: selectedProgram,
      monthlyRent: rentNum,
      basePrice: priceNum,
      durationMonths,
      startDate,
      depositMonths,
      customDeposit: depositNum,
      customSavingsPerMonth: savingsNum,
      hasAdvanceRent,
      advanceRentMonths,
      contractFee: feeNum,
      customYear4MonthlyRent: !isNaN(year4RentNum) && year4RentNum > 0 ? year4RentNum : undefined
    });
  }, [selectedProgram, monthlyRent, depositMonths, customDeposit, savingsPerMonth, basePrice, durationMonths, startDate, hasAdvanceRent, advanceRentMonths, contractFee, year4AgreedRent]);

  if (!isOpen) return null;

  const currentProgram = RENTAL_PROGRAM_DETAILS[selectedProgram];
  const selectedPlot = plotsList.find(p => p.id === selectedPlotId);
  const effectiveLead = isNewLeadMode ? null : selectedLead || initialLead;
  const leadOwnerName = effectiveLead?.agent_name || effectiveLead?.sales_owner || effectiveLead?.salesOwner || null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy.current || loadingPlots) return;
    const requestScope = currentScope.current;
    if (!saveProgress.current && !salesOwners.some(owner => owner.displayName === agentName)) {
      setErrorMsg('กรุณาเลือกพนักงานฝ่ายขาย');
      return;
    }
    setErrorMsg(null);
    setSubmitting(true);
    busy.current = true;
    let progress = saveProgress.current;
    try {
      if (!progress) {
        const effectiveLead = isNewLeadMode ? null : selectedLead || initialLead;
        if (effectiveLead) {
          const stage = getLeadStage(effectiveLead);
          const isAllowedStage = canStartSalesDeal(effectiveLead) || stage === 'booked' || effectiveLead?.deal_type === 'rent';
          if (!isAllowedStage) {
            throw new Error('ลูกค้ารายนี้อยู่ในขั้นตอนโอน หรือสิ้นสุดแล้ว กรุณาจัดการรายการเดิม');
          }
        }
        if (!tenantName.trim()) throw new Error('กรุณาระบุชื่อผู้เช่า');
        if (!targetProject || !selectedPlotId) throw new Error('กรุณาเลือกโครงการและแปลงที่จะทำสัญญาเช่า');
        const rentNum = parseFloat(monthlyRent) || 0;
        if (rentNum <= 0) throw new Error('กรุณาระบุค่าเช่าต่อเดือนให้ถูกต้อง');
        const now = new Date().toISOString();
        const bookingAmountNum = parseFloat(bookingAmount) || 0;
        const bookingIso = bookingDate ? `${bookingDate}T00:00:00.000Z` : null;
        const contractIso = contractDate ? `${contractDate}T00:00:00.000Z` : now;
        const depositNum = parseFloat(customDeposit) || rentNum * 2;
        const savingsNum = selectedProgram === 'program_b' ? parseFloat(savingsPerMonth) || 5000 : 0;
        const priceNum = (selectedProgram === 'program_b' || selectedProgram === 'program_c') ? parseFloat(basePrice) || 0 : 0;
        let targetLeadId: string | null = effectiveLead?.id || null;
        let targetContractId: string | null = null;
        const crmStatus = selectedProgram === 'program_b'
          ? 'Rent-to-Own / Active — สัญญาเช่าซื้อ/เช่าออม (สะสมเงินดาวน์)'
          : 'Rented / Active — ทำสัญญาเช่าแล้ว (อยู่ระหว่างเช่า)';
        const leadPayload = {
          deal_type: 'rent', rental_program: selectedProgram, crm_status: crmStatus,
          interested_plot_id: selectedPlotId, interested_plot_name: selectedPlot?.plot_name || selectedPlotId,
          rental_monthly_rent: rentNum, rental_deposit: depositNum, rental_savings_per_month: savingsNum,
          rental_base_price: priceNum, rental_start_date: startDate, rental_end_date: calcResults.endDate,
          rental_status: 'Active',
          booking_date: bookingIso,
          booking_amount: bookingAmountNum,
          contracted_at: contractIso
        };
        if (targetLeadId) {
          const { data, error } = await supabase.from('rental_contracts').select('id')
            .eq('lead_id', targetLeadId).in('status', ['Active', 'Renewed']).limit(1);
          if (requestScope !== currentScope.current) return;
          if (error) throw error;
          if (data?.length) throw new Error('ลูกค้ามีสัญญาเช่าที่ใช้งานอยู่แล้ว กรุณาจัดการสัญญาเดิม');
        }
        const steps: (() => Promise<void>)[] = [];
        if (!targetLeadId) steps.push(async () => {
          const { data, error } = await supabase.from('leads').insert([{
            customer_name: tenantName.trim(), phone: tenantPhone.trim(), project_name: targetProject,
            channel: 'Walk in', source: 'Walk in', agent_name: agentName.trim(),
            created_by_agent: agentName.trim(), ...leadPayload, notes: notes.trim() || null, created_at: contractIso
          }]).select('id').single();
          if (error) throw error;
          if (!data?.id) throw new Error('สร้างลูกค้าไม่สำเร็จ');
          targetLeadId = data.id;
        });
        steps.push(async () => {
          const year4InterestNote = (selectedProgram === 'program_c' && durationMonths > 36)
            ? `[ปีที่ 4+: ค่างวดตกลง ${calcResults.year4BaseRent.toLocaleString()} บ. + ดอกเบี้ย 8% รวม ${calcResults.year4MonthlyRent.toLocaleString()} บ./ด.]`
            : null;

          const depositNote = (depositMonths !== 2 || depositNum !== rentNum * 2)
            ? `[เงินประกัน ${depositMonths} เดือน: ${depositNum.toLocaleString()} บ.]`
            : null;
          const contractFeeNum = selectedProgram === 'program_c' ? (parseFloat(contractFee) || 0) : 0;
          const contractFeeNote = contractFeeNum > 0 ? `[ค่าทำสัญญา: ${contractFeeNum.toLocaleString()} บ.]` : null;
          const advanceRentNote = hasAdvanceRent
            ? `[ค่าเช่าล่วงหน้า ${advanceRentMonths} เดือน: ${calcResults.advanceRent.toLocaleString()} บ.]`
            : '[ไม่เก็บค่าเช่าล่วงหน้า]';

          const contractNotes = [
            notes.trim() || null,
            bookingAmountNum > 0 ? `[เงินจอง: ${bookingAmountNum.toLocaleString()} บ.]` : null,
            bookingDate ? `[วันที่จอง: ${bookingDate}]` : null,
            contractDate ? `[วันที่ทำสัญญา: ${contractDate}]` : null,
            priceNum > 0 ? `[ราคาบ้านตกลง: ${priceNum.toLocaleString()} บ.]` : null,
            depositNote,
            contractFeeNote,
            advanceRentNote,
            year4InterestNote
          ].filter(Boolean).join(' ') || null;

          const payload: Partial<RentalContract> & { created_at?: string } = {
            lead_id: targetLeadId, project_name: targetProject, plot_id: selectedPlotId,
            plot_name: selectedPlot?.plot_name || selectedPlotId, tenant_name: tenantName.trim(),
            tenant_phone: tenantPhone.trim() || null, agent_name: agentName.trim(), program_type: selectedProgram,
            monthly_rent: rentNum, security_deposit: depositNum, advance_rent: calcResults.advanceRent,
            savings_per_month: savingsNum, accumulated_savings: 0, base_price: priceNum,
            discount_1yr_pct: 10, discount_2yr_pct: 5, lease_duration_months: durationMonths,
            lease_start_date: startDate, lease_end_date: calcResults.endDate, status: 'Active',
            notes: contractNotes, created_at: contractIso, updated_at: now
          };
          const { data, error } = await supabase.from('rental_contracts').insert([payload]).select('id').single();
          if (error) throw error;
          if (!data?.id) throw new Error('สร้างสัญญาเช่าไม่สำเร็จ');
          targetContractId = data.id;
        });
        steps.push(async () => {
          const dateSuffix = contractDate ? ` (ทำสัญญา: ${contractDate})` : '';
          const bookingSuffix = bookingAmountNum > 0 ? ` (เงินจอง: ${bookingAmountNum.toLocaleString()} บ.)` : '';
          const priceSuffix = priceNum > 0 ? ` (ราคาบ้าน: ${priceNum.toLocaleString()} บ.)` : '';
          const depositSuffix = (depositMonths !== 2 || depositNum !== rentNum * 2) ? ` (ประกัน ${depositMonths} ด.: ${depositNum.toLocaleString()} บ.)` : '';
          const contractFeeNum = selectedProgram === 'program_c' ? (parseFloat(contractFee) || 0) : 0;
          const feeSuffix = contractFeeNum > 0 ? ` (ค่าสัญญา: ${contractFeeNum.toLocaleString()} บ.)` : '';
          const advanceSuffix = hasAdvanceRent ? ` (ล่วงหน้า ${advanceRentMonths} ด.: ${calcResults.advanceRent.toLocaleString()} บ.)` : ' (ไม่มีค่าเช่าล่วงหน้า)';
          const year4Suffix = (selectedProgram === 'program_c' && durationMonths > 36) ? ` (ปีที่ 4+: ค่างวดตกลง ${calcResults.year4BaseRent.toLocaleString()} บ. + ดอกเบี้ย 8% รวม ${calcResults.year4MonthlyRent.toLocaleString()} บ./ด.)` : '';
          const leadNotes = notes
            ? ((effectiveLead?.notes || '') + '\n[สัญญาเช่า ' + currentProgram.name + dateSuffix + bookingSuffix + priceSuffix + depositSuffix + feeSuffix + advanceSuffix + year4Suffix + ']: ' + notes).trim()
            : effectiveLead?.notes;
          const { data, error } = await supabase.from('leads').update({
            ...leadPayload, active_rental_contract_id: targetContractId,
            notes: leadNotes
          }).eq('id', targetLeadId!).select('id').single();
          if (error) throw error;
          if (!data?.id) throw new Error('ไม่พบลูกค้าที่อัปเดตได้');
        });
        steps.push(async () => {
          const { data, error } = await supabase.from('plots').update({
            sale_status: 'Rented', has_customer: true, current_tenant_name: tenantName.trim(),
            current_tenant_phone: tenantPhone.trim() || null, rental_program: selectedProgram,
            monthly_rent: rentNum, security_deposit: depositNum, lease_start_date: startDate,
            lease_end_date: calcResults.endDate, highlight_note: 'เช่า: ' + currentProgram.name + ' (' + tenantName.trim() + ')'
          }).eq('id', selectedPlotId).select('id').single();
          if (error) throw error;
          if (!data?.id) throw new Error('ไม่พบแปลงที่อัปเดตได้');
        });
        progress = { completed: 0, steps };
        saveProgress.current = progress;
      }
      while (progress.completed < progress.steps.length) {
        if (requestScope !== currentScope.current) return;
        await progress.steps[progress.completed]();
        progress.completed++;
      }
      if (requestScope !== currentScope.current) return;
      saveProgress.current = null;
      onSaved?.();
      onClose();
    } catch (error) {
      if (requestScope === currentScope.current) {
        const detail = error instanceof Error ? error.message : (error as { message?: string })?.message || 'บันทึกสัญญาเช่าไม่สำเร็จ';
        if (progress && progress.completed > 0) {
          setErrorMsg('บันทึกบางส่วนแล้ว แต่ยังไม่ครบ: ' + detail + ' กดยืนยันอีกครั้งเพื่อบันทึกส่วนที่เหลือ');
        } else {
          saveProgress.current = null;
          setErrorMsg(detail);
        }
      }
    } finally {
      if (requestScope === currentScope.current) {
        busy.current = false;
        setSubmitting(false);
      }
    }
  };

  return (
    <SalesOverlay className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto animate-fade-in">
      <div className="bg-white rounded-3xl max-w-4xl w-full shadow-2xl border border-slate-200 overflow-hidden my-auto flex flex-col max-h-[92vh]">
        
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white px-6 py-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-500/20 text-cyan-300 rounded-2xl border border-cyan-400/30">
              <Key size={22} className="animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-lg text-white">
                  🔑 ทำสัญญาเช่า / เช่าออม (Ailin Rental)
                </h3>
                <span className="text-[10px] bg-cyan-400/20 text-cyan-200 font-bold px-2 py-0.5 rounded-full border border-cyan-400/30">
                  {targetProject}
                </span>
              </div>
              <p className="text-xs text-blue-200/80 mt-0.5">
                บันทึกสัญญาเช่า 3 โปรแกรม ดึงลูกค้าจาก CRM และคำนวณเงินประกันอัตโนมัติ
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

        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-5 text-xs overflow-y-auto flex-1 dark-scrollbar">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center gap-2 font-medium">
              <AlertCircle size={16} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <fieldset disabled={submitting || (saveProgress.current?.completed || 0) > 0} className="contents">
          {/* 🌟 1. Three Rental Programs Selector Tabs 🌟 */}
          <div>
            <label className="block text-slate-700 font-bold mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs text-slate-800">
                <Sparkles size={14} className="text-amber-500" /> เลือกโปรแกรมการเช่า (Rental Program) *
              </span>
              <span className="text-[11px] text-slate-500 font-normal">
                ตามเงื่อนไขบ้านจัดสรรไอลิน
              </span>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {/* Program A */}
              <button
                type="button"
                onClick={() => setSelectedProgram('program_a')}
                className={`p-3 rounded-2xl border-2 text-left transition-all cursor-pointer relative flex flex-col justify-between ${
                  selectedProgram === 'program_a'
                    ? 'border-blue-600 bg-blue-50/80 shadow-md ring-2 ring-blue-500/20'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100/70 text-slate-600'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-black text-xs px-2 py-0.5 rounded-md bg-blue-600 text-white">
                      แบบ A
                    </span>
                    {selectedProgram === 'program_a' && (
                      <CheckCircle2 size={16} className="text-blue-600" />
                    )}
                  </div>
                  <div className="font-bold text-slate-900 text-xs mt-1">Rent (เช่า)</div>
                  <div className="text-[10px] text-blue-700 font-semibold mt-0.5">อยู่สบาย ไม่ต้องซื้อ</div>
                </div>
                <div className="mt-2.5 pt-2 border-t border-slate-200/60 text-[10px] text-slate-500 space-y-0.5">
                  <div>• ประกัน 2 เดือน</div>
                  <div>• สัญญาขั้นต่ำ 12 เดือน</div>
                </div>
              </button>

              {/* Program B */}
              <button
                type="button"
                onClick={() => setSelectedProgram('program_b')}
                className={`p-3 rounded-2xl border-2 text-left transition-all cursor-pointer relative flex flex-col justify-between ${
                  selectedProgram === 'program_b'
                    ? 'border-amber-500 bg-amber-50/80 shadow-md ring-2 ring-amber-500/20'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100/70 text-slate-600'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-black text-xs px-2 py-0.5 rounded-md bg-amber-500 text-white">
                      แบบ B
                    </span>
                    {selectedProgram === 'program_b' && (
                      <CheckCircle2 size={16} className="text-amber-600" />
                    )}
                  </div>
                  <div className="font-bold text-slate-900 text-xs mt-1">Rent to Own (เช่าซื้อ)</div>
                  <div className="text-[10px] text-amber-700 font-semibold mt-0.5">เช่าก่อน มีสิทธิ์เป็นเจ้าของ</div>
                </div>
                <div className="mt-2.5 pt-2 border-t border-slate-200/60 text-[10px] text-slate-500 space-y-0.5">
                  <div>• <b>สะสม 5,000 บ./เดือน</b></div>
                  <div>• หักค่าบ้านเมื่อโอนจริง</div>
                </div>
              </button>

              {/* Program C */}
              <button
                type="button"
                onClick={() => setSelectedProgram('program_c')}
                className={`p-3 rounded-2xl border-2 text-left transition-all cursor-pointer relative flex flex-col justify-between ${
                  selectedProgram === 'program_c'
                    ? 'border-emerald-600 bg-emerald-50/80 shadow-md ring-2 ring-emerald-500/20'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100/70 text-slate-600'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-black text-xs px-2 py-0.5 rounded-md bg-emerald-600 text-white">
                      แบบ C
                    </span>
                    {selectedProgram === 'program_c' && (
                      <CheckCircle2 size={16} className="text-emerald-600" />
                    )}
                  </div>
                  <div className="font-bold text-slate-900 text-xs mt-1">Rent and Save (เช่าออม)</div>
                  <div className="text-[10px] text-emerald-700 font-semibold mt-0.5">เช่าบ้าน พร้อมออมเงิน</div>
                </div>
                <div className="mt-2.5 pt-2 border-t border-slate-200/60 text-[10px] text-slate-500 space-y-0.5">
                  <div>• <b>โอนใน 1 ปี ลด 10%</b></div>
                  <div>• โอนใน 2 ปี ลด 5%</div>
                </div>
              </button>
            </div>
          </div>

          {/* 📍 2. Customer & Plot Selection with LeadPicker */}
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/80 space-y-3.5">
            <h4 className="font-bold text-slate-800 text-xs flex items-center gap-1.5 border-b border-slate-200/60 pb-2">
              <Home size={14} className="text-blue-600" /> ข้อมูลผู้เช่าและแปลงบ้าน
            </h4>

            {/* Reusable Searchable Lead Selector */}
            <LeadPicker
              selectedLead={selectedLead}
              onSelectLead={handleLeadSelect}
              projectName={targetProject}
              currentPlotName={selectedPlot?.plot_name || selectedPlotId}
              isCreateNewMode={isNewLeadMode}
              onToggleCreateNew={(isNew) => {
                setIsNewLeadMode(isNew);
                if (isNew) {
                  setSelectedLead(null);
                  setTenantName('');
                  setTenantPhone('');
                  const defaultAgent = selectSalesStaffName(salesOwners, [user?.displayName, user?.username, user?.name]);
                  setAgentName(defaultAgent);
                  setOwnerSource(defaultAgent && [user?.displayName, user?.username, user?.name].includes(defaultAgent) ? 'current_user' : 'manual');
                }
              }}
              label="เลือกลูกค้าผู้เช่าจาก Lead CRM"
              placeholder="🔍 พิมพ์ค้นหาชื่อ หรือ เบอร์โทรลูกค้า..."
            />

            {/* 🎯 แสดงข้อมูลเจ้าของ Lead เดิม */}
            {!isNewLeadMode && effectiveLead && leadOwnerName && (
              <div className="flex items-center justify-between p-2.5 bg-blue-50/90 border border-blue-200/80 rounded-xl text-xs text-blue-950 font-medium animate-in fade-in">
                <span className="flex items-center gap-1.5 text-blue-800">
                  <User size={13} className="text-blue-600 shrink-0" /> เจ้าของ Lead: <b className="text-blue-900 font-bold underline decoration-blue-300">{leadOwnerName}</b>
                </span>
                <span className="text-[10px] text-blue-600 bg-blue-100/90 px-2 py-0.5 rounded-full font-semibold border border-blue-200">
                  ผู้ดูแลในระบบ CRM
                </span>
              </div>
            )}

            {/* If in Walk-in / Create New mode or editing */}
            {isNewLeadMode && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-blue-50/60 rounded-xl border border-blue-200/80 animate-in fade-in duration-200">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    ชื่อผู้เช่า (Customer Name) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={tenantName}
                    onChange={e => setTenantName(e.target.value)}
                    placeholder="เช่น คุณสมศรี มีสุข (ลูกค้า Walk-in)"
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">เบอร์โทรศัพท์ (Phone)</label>
                  <input
                    type="tel"
                    value={tenantPhone}
                    onChange={e => setTenantPhone(e.target.value)}
                    placeholder="08x-xxx-xxxx"
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-slate-700 font-bold mb-1">เลือกแปลงบ้านที่เช่า *</label>
                <select
                  value={selectedPlotId}
                  onChange={e => handlePlotChange(e.target.value)}
                  required
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-bold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  <option value="">-- เลือกแปลงบ้าน (เรียงตามลำดับเลขแปลง) --</option>
                  {availableAndBookedPlots.map(p => {
                    const isMyPlot = p.id === selectedPlotId || p.id === (effectiveLead?.interested_plot_id || plotId) || (effectiveLead?.customer_name && p.customer_name === effectiveLead.customer_name);
                    const isBooked = p.sale_status === 'Booked' || p.sale_status === 'Reserved' || (p.has_customer && !p.current_tenant_name);
                    
                    let tag = '🟢 ว่าง';
                    let disabled = false;
                    if (isMyPlot && isBooked) {
                      tag = '🟡 ติดจอง (แปลงของลูกค้ารายนี้)';
                      disabled = false;
                    } else if (isBooked) {
                      tag = '🟡 ติดจอง';
                      disabled = true;
                    } else if (p.sale_status === 'Rented' || p.current_tenant_name) {
                      tag = '🔵 มีผู้เช่า';
                      disabled = !isMyPlot;
                    }

                    const priceVal = p.price || p.selling_price || p.base_price;
                    return (
                      <option key={p.id} value={p.id} disabled={disabled}>
                        {p.plot_name || p.id} ({tag}) {priceVal ? `- ${Number(priceVal).toLocaleString()} บ.` : ''}
                      </option>
                    );
                  })}
                </select>
                {loadingPlots && <p className="text-[10px] text-slate-400 mt-1">กำลังโหลดแปลง...</p>}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-700 font-bold text-xs flex items-center gap-1">
                    <User size={13} className="text-slate-600" /> ผู้บันทึกสัญญา / เซลล์ผู้ดูแล <span className="text-rose-500">*</span>
                  </label>
                  {ownerSource === 'current_user' && (
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100/80 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1 animate-in fade-in">
                      <Sparkles size={10} className="text-emerald-600" /> ผู้ใช้ที่ล็อกอินอยู่ (คุณ)
                    </span>
                  )}
                  {ownerSource === 'manual' && (
                    <span className="text-[10px] font-bold text-amber-700 bg-amber-100/80 border border-amber-200 px-2 py-0.5 rounded-full animate-in fade-in">
                      ระบุเอง
                    </span>
                  )}
                </div>
                {salesOwners && salesOwners.length > 0 ? (
                  <select
                    value={agentName}
                    onChange={e => {
                      setAgentName(e.target.value);
                      setOwnerSource('manual');
                    }}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-2xs"
                  >
                    {salesOwners.map(o => (
                      <option key={o.userId} value={o.displayName}>{o.displayName}</option>
                    ))}
                  </select>
                ) : (
                  <select value="" disabled className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800">
                    <option value="">ไม่พบพนักงานฝ่ายขาย</option>
                  </select>
                )}
                <div className="text-[10px] text-slate-500 font-medium flex items-center justify-between flex-wrap gap-1 mt-1">
                  <span>บันทึกชื่อผู้ใช้งานที่ทำสัญญานี้ (สามารถเลือกเปลี่ยนชื่อได้)</span>
                  {leadOwnerName && leadOwnerName !== agentName && (
                    <span className="text-blue-700 font-semibold bg-blue-50 border border-blue-200/60 px-1.5 py-0.5 rounded">
                      Lead เดิม: {leadOwnerName}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 💰 3. Lease & Financial Terms */}
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/80 space-y-3">
            <h4 className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
              <DollarSign size={14} className="text-emerald-600" /> เงื่อนไขสัญญาเช่า & การชำระเงิน
            </h4>

            {/* 📅 วันที่สำคัญ & เงินจอง (Key Dates & Booking History) */}
            <div className="p-3.5 sm:p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-slate-100 pb-2">
                <span className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                  <Calendar size={14} className="text-blue-600" /> ข้อมูลการจอง & กำหนดวันทำสัญญา (รองรับการบันทึกย้อนหลัง)
                </span>
                <span className="text-[11px] text-slate-500 font-medium">
                  ใส่วันที่และเงินจองย้อนหลังได้ตามจริง
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                {/* 1. วันที่จอง */}
                <div>
                  <label htmlFor="rental-booking-date" className="block text-slate-700 font-bold mb-1 text-[11px]">
                    วันที่จอง (Booking Date)
                  </label>
                  <input
                    id="rental-booking-date"
                    type="date"
                    value={bookingDate}
                    onChange={e => setBookingDate(e.target.value)}
                    className="w-full bg-slate-50/80 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-400 block mt-0.5">วันวางเงินจอง (ถ้ามี)</span>
                </div>

                {/* 2. เงินจอง */}
                <div>
                  <label htmlFor="rental-booking-amount" className="block text-slate-700 font-bold mb-1 text-[11px]">
                    เงินจอง / มัดจำ (บาท)
                  </label>
                  <div className="relative">
                    <input
                      id="rental-booking-amount"
                      type="number"
                      min="0"
                      step="1000"
                      value={bookingAmount}
                      onChange={e => setBookingAmount(e.target.value)}
                      placeholder="เช่น 10,000"
                      className="w-full bg-slate-50/80 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none pr-8"
                    />
                    <span className="absolute right-3 top-2.5 text-[11px] text-slate-400 font-bold pointer-events-none">บาท</span>
                  </div>
                  <span className="text-[10px] text-slate-400 block mt-0.5">นำไปหักวันโอนกรรมสิทธิ์</span>
                </div>

                {/* 3. วันที่ทำสัญญา */}
                <div>
                  <label htmlFor="rental-contract-date" className="block text-slate-700 font-bold mb-1 text-[11px]">
                    วันที่ทำสัญญา (Contract Date) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="rental-contract-date"
                    type="date"
                    required
                    value={contractDate}
                    onChange={e => setContractDate(e.target.value)}
                    className="w-full bg-slate-50/80 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-400 block mt-0.5">วันที่เซ็นสัญญาเช่า</span>
                </div>

                {/* 4. วันเริ่มต้นสัญญา */}
                <div>
                  <label htmlFor="rental-start-date" className="block text-slate-700 font-bold mb-1 text-[11px]">
                    วันเริ่มต้นสัญญา (Start Date) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="rental-start-date"
                    type="date"
                    required
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="w-full bg-slate-50/80 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-400 block mt-0.5">วันเริ่มเข้าพัก/คิดค่าเช่า</span>
                </div>
              </div>

              {/* แถบคำนวณวันสิ้นสุดสัญญาอัตโนมัติ */}
              <div className="bg-blue-50/70 border border-blue-200/80 rounded-xl px-3.5 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-xs text-blue-900">
                <div className="flex items-center gap-2">
                  <Calendar size={15} className="text-blue-600 shrink-0" />
                  <span className="font-bold text-slate-700">วันสิ้นสุดสัญญา (คำนวณอัตโนมัติ):</span>
                  <span className="font-black text-blue-950 bg-white px-2.5 py-0.5 rounded-lg border border-blue-200 shadow-2xs">
                    {calcResults.endDate}
                  </span>
                </div>
                <span className="text-[11px] text-blue-700 font-medium">
                  ครอบคลุมระยะเวลา {durationMonths} เดือน ({startDate} ถึง {calcResults.endDate})
                </span>
              </div>
            </div>

            {/* 💵 ค่าเช่ารายเดือน, ระยะเวลา, เงินประกัน & ค่าเช่าล่วงหน้า */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1">
              {/* 1. ค่าเช่าต่อเดือน */}
              <div className="p-3.5 bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-1.5 flex flex-col justify-between">
                <div>
                  <label htmlFor="rental-monthly-rent" className="block text-slate-800 font-bold text-xs mb-1">
                    ค่าเช่าต่อเดือน (บาท) <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="rental-monthly-rent"
                      type="number"
                      required
                      min="0"
                      step="500"
                      value={monthlyRent}
                      onChange={e => setMonthlyRent(e.target.value)}
                      className="w-full bg-slate-50/80 border border-slate-300 rounded-xl px-3 py-2 font-black text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm pr-16"
                    />
                    <span className="absolute right-3 top-2.5 text-xs text-slate-400 font-bold pointer-events-none">บาท/เดือน</span>
                  </div>
                </div>
                <span className="text-[10px] text-slate-500 block">
                  ค่าเช่าอยู่อาศัยรายเดือนที่ระบุในสัญญา
                </span>
              </div>

              {/* 2. ระยะเวลาสัญญาเช่า */}
              <div className="p-3.5 bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-1.5 flex flex-col justify-between">
                <div>
                  <label htmlFor="rental-duration-months" className="block text-slate-800 font-bold text-xs mb-1">
                    ระยะเวลาสัญญาเช่า (เดือน) <span className="text-rose-500">*</span>
                  </label>
                  <select
                    id="rental-duration-months"
                    value={durationMonths}
                    onChange={e => setDurationMonths(parseInt(e.target.value) || 12)}
                    className="w-full bg-slate-50/80 border border-slate-300 rounded-xl px-3 py-2 font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none text-xs"
                  >
                    <option value={12}>12 เดือน (1 ปี - ขั้นต่ำ)</option>
                    <option value={24}>24 เดือน (2 ปี)</option>
                    <option value={36}>36 เดือน (3 ปี)</option>
                    <option value={48}>48 เดือน (4 ปี — เข้าปีที่ 4 บวกดอกเบี้ย 8%)</option>
                    <option value={60}>60 เดือน (5 ปี — เข้าปีที่ 4 เป็นต้นไป บวกดอกเบี้ย 8%)</option>
                  </select>
                </div>
                <span className="text-[10px] text-slate-500 block">
                  กำหนดสิ้นสุด: {calcResults.endDate}
                </span>
              </div>

              {/* 3. เงินประกันบ้าน */}
              <div className="p-3.5 bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-1.5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label htmlFor="rental-custom-deposit" className="text-slate-800 font-bold text-xs">
                      เงินประกันบ้าน
                    </label>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[11px] text-slate-500 font-semibold">เลือก:</span>
                      <select
                        aria-label="จำนวนเดือนเงินประกันบ้าน"
                        value={depositMonths}
                        onChange={e => {
                          const m = parseInt(e.target.value) || 0;
                          setDepositMonths(m);
                          const rentNum = parseFloat(monthlyRent) || 0;
                          setCustomDeposit((rentNum * m).toString());
                        }}
                        className="bg-slate-100 hover:bg-slate-200/80 border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none cursor-pointer"
                      >
                        <option value={0}>0 เดือน (ไม่มี)</option>
                        <option value={1}>1 เดือน</option>
                        <option value={2}>2 เดือน (มาตรฐาน)</option>
                        <option value={3}>3 เดือน</option>
                        <option value={4}>4 เดือน</option>
                        <option value={5}>5 เดือน</option>
                        <option value={6}>6 เดือน</option>
                      </select>
                    </div>
                  </div>
                  <div className="relative">
                    <input
                      id="rental-custom-deposit"
                      type="number"
                      min="0"
                      value={customDeposit}
                      onChange={e => setCustomDeposit(e.target.value)}
                      className="w-full bg-slate-50/80 border border-slate-300 rounded-xl px-3 py-2 font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none text-xs pr-10"
                    />
                    <span className="absolute right-3 top-2.5 text-xs text-slate-400 font-bold pointer-events-none">บาท</span>
                  </div>
                </div>
                <span className="text-[10px] text-slate-500 block">
                  {depositMonths > 0 
                    ? `คำนวณ ${depositMonths} เดือน (${(parseFloat(monthlyRent) || 0).toLocaleString()} × ${depositMonths}) หรือปรับยอดได้`
                    : 'ไม่เรียกเก็บเงินประกันบ้าน'}
                </span>
              </div>

              {/* 4. ค่าเช่าล่วงหน้า */}
              <div className="p-3.5 bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-1.5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="text-slate-800 font-bold text-xs flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={hasAdvanceRent}
                        onChange={e => setHasAdvanceRent(e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                      />
                      <span>เก็บค่าเช่าล่วงหน้า</span>
                    </label>
                    {hasAdvanceRent && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[11px] text-slate-500 font-semibold">เลือก:</span>
                        <select
                          aria-label="จำนวนเดือนค่าเช่าล่วงหน้า"
                          value={advanceRentMonths}
                          onChange={e => setAdvanceRentMonths(parseInt(e.target.value) || 1)}
                          className="bg-slate-100 hover:bg-slate-200/80 border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none cursor-pointer"
                        >
                          <option value={1}>1 เดือน</option>
                          <option value={2}>2 เดือน</option>
                          <option value={3}>3 เดือน</option>
                          <option value={4}>4 เดือน</option>
                          <option value={5}>5 เดือน</option>
                          <option value={6}>6 เดือน</option>
                        </select>
                      </div>
                    )}
                  </div>
                  <div className={`w-full border rounded-xl px-3 py-2 font-bold text-xs flex items-center justify-between transition-colors ${
                    hasAdvanceRent 
                      ? 'bg-slate-100/90 border-slate-300 text-slate-900' 
                      : 'bg-slate-100/50 border-slate-200 text-slate-400'
                  }`}>
                    <span>{hasAdvanceRent ? `${calcResults.advanceRent.toLocaleString()} บาท` : '0 บาท (ไม่เรียกเก็บ)'}</span>
                    {hasAdvanceRent && <span className="text-[10px] text-slate-500 font-normal">ชำระวันทำสัญญา</span>}
                  </div>
                </div>
                <span className="text-[10px] text-slate-500 block">
                  {hasAdvanceRent 
                    ? `คำนวณ ${advanceRentMonths} เดือน (${(parseFloat(monthlyRent) || 0).toLocaleString()} × ${advanceRentMonths})` 
                    : 'ไม่เรียกเก็บค่าเช่าล่วงหน้า'}
                </span>
              </div>
            </div>

            {/* Program B Specific: House Price & Savings Breakdown */}
            {selectedProgram === 'program_b' && (
              <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-200 space-y-3 animate-fade-in">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-900 text-xs flex items-center gap-1">
                    <PiggyBank size={15} className="text-amber-600" /> โปรแกรมเช่าซื้อ (Rent to Own) — กำหนดราคาบ้าน & สะสมเงินดาวน์
                  </span>
                  <span className="text-[11px] bg-amber-200 text-amber-900 font-black px-2 py-0.5 rounded-full">
                    สะสมปีละ {calcResults.projected1YrSavings.toLocaleString()} บาท
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="rental-base-price-b" className="block text-amber-900 font-bold mb-1">
                      ราคาบ้านที่ตกลงซื้อขาย (บาท) <span className="text-rose-500">*</span>
                    </label>
                    <input
                      id="rental-base-price-b"
                      type="number"
                      min="0"
                      step="10000"
                      required
                      value={basePrice}
                      onChange={e => setBasePrice(e.target.value)}
                      className="w-full bg-white border border-amber-300 rounded-xl px-3 py-2 font-black text-amber-950 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-amber-800 mt-0.5 block">
                      ราคาบ้านที่ตกลงขายตามสัญญา (ดึงจากแปลง สามารถปรับได้)
                    </span>
                  </div>

                  <div>
                    <label htmlFor="rental-savings-b" className="block text-amber-900 font-bold mb-1">
                      เงินสะสมเพื่อซื้อบ้านรายเดือน (บาท/เดือน)
                    </label>
                    <input
                      id="rental-savings-b"
                      type="number"
                      min="0"
                      step="500"
                      value={savingsPerMonth}
                      onChange={e => setSavingsPerMonth(e.target.value)}
                      className="w-full bg-white border border-amber-300 rounded-xl px-3 py-2 font-black text-amber-950 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-amber-800 mt-0.5 block">
                      ชำระรวมรายเดือน (ค่าเช่า + เงินสะสม) = <b>{(calcResults.monthlyRent + calcResults.savingsPerMonth).toLocaleString()} บาท/ด.</b>
                    </span>
                  </div>
                </div>

                {/* Calculation Summary Box for Program B */}
                {(() => {
                  const bPrice = parseFloat(basePrice) || 0;
                  const bDeposit = parseFloat(bookingAmount) || 0;
                  const totalSavings = calcResults.savingsPerMonth * durationMonths;
                  const netTransferPrice = Math.max(0, bPrice - bDeposit - totalSavings);

                  return (
                    <div className="p-3 bg-white rounded-xl border border-amber-300/80 space-y-1.5 shadow-2xs">
                      <div className="text-[11px] font-bold text-amber-900 flex items-center justify-between">
                        <span>สรุปการหักเงินดาวน์สะสม ณ วันโอนกรรมสิทธิ์ ({durationMonths} เดือน):</span>
                        <span className="text-amber-700 font-bold">หักรวม {(bDeposit + totalSavings).toLocaleString()} บาท</span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-center text-xs">
                        <div className="bg-amber-50/70 p-2 rounded-lg border border-amber-100">
                          <div className="text-[10px] text-slate-500">ราคาบ้านตกลง</div>
                          <div className="font-bold text-slate-900">{bPrice.toLocaleString()} บ.</div>
                        </div>
                        <div className="bg-amber-50/70 p-2 rounded-lg border border-amber-100">
                          <div className="text-[10px] text-amber-700">หักเงินจอง</div>
                          <div className="font-bold text-amber-800">-{bDeposit.toLocaleString()} บ.</div>
                        </div>
                        <div className="bg-amber-50/70 p-2 rounded-lg border border-amber-100">
                          <div className="text-[10px] text-amber-700">หักสะสม ({durationMonths} ด.)</div>
                          <div className="font-bold text-amber-800">-{totalSavings.toLocaleString()} บ.</div>
                        </div>
                        <div className="bg-emerald-50 p-2 rounded-lg border border-emerald-200">
                          <div className="text-[10px] text-emerald-700 font-bold">🎯 ยอดกู้/ชำระวันโอน</div>
                          <div className="font-black text-emerald-700">{netTransferPrice.toLocaleString()} บ.</div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Program C Specific: Base Price, Discounts & Year 4+ Interest */}
            {selectedProgram === 'program_c' && (
              <div className="p-3.5 bg-emerald-50 rounded-xl border border-emerald-200 space-y-2.5 animate-fade-in">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-900 text-xs flex items-center gap-1">
                    <Percent size={15} className="text-emerald-600" /> โปรแกรมเช่าออม (Rent and Save) — ราคาตั้ง, ส่วนลด & เงื่อนไขดอกเบี้ยปีที่ 4
                  </span>
                  <span className="text-[11px] bg-emerald-200 text-emerald-900 font-black px-2 py-0.5 rounded-full">
                    Rent and Save
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="rental-base-price-c" className="block text-emerald-800 font-bold mb-1">
                      ราคาตั้ง / Base Price (บาท) <span className="text-rose-500">*</span>
                    </label>
                    <input
                      id="rental-base-price-c"
                      type="number"
                      min="0"
                      step="10000"
                      required
                      value={basePrice}
                      onChange={e => setBasePrice(e.target.value)}
                      className="w-full bg-white border border-emerald-300 rounded-xl px-3 py-2 font-black text-emerald-950 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-emerald-700 mt-0.5 block">
                      ราคาบ้านตั้งต้นที่นำมาคำนวณสิทธิ์ส่วนลดโอน 10% หรือ 5%
                    </span>
                  </div>

                  <div>
                    <label htmlFor="rental-contract-fee-c" className="block text-emerald-800 font-bold mb-1 flex items-center justify-between">
                      <span>ค่าทำสัญญา (บาท)</span>
                      <span className="text-[10px] font-normal text-emerald-700 bg-emerald-200/80 px-1.5 py-0.2 rounded">เฉพาะแบบ C</span>
                    </label>
                    <input
                      id="rental-contract-fee-c"
                      type="number"
                      min="0"
                      step="1000"
                      value={contractFee}
                      onChange={e => setContractFee(e.target.value)}
                      className="w-full bg-white border border-emerald-300 rounded-xl px-3 py-2 font-black text-emerald-950 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-emerald-700 mt-0.5 block">
                      ค่าธรรมเนียมทำสัญญาเช่าออม (รวมในยอดชำระวันทำสัญญา)
                    </span>
                  </div>
                </div>

                {(() => {
                  const bDeposit = parseFloat(bookingAmount) || 0;
                  const netWithDeposit1Yr = Math.max(0, calcResults.netPrice1Yr - bDeposit);
                  const netWithDeposit2Yr = Math.max(0, calcResults.netPrice2Yr - bDeposit);
                  const bPrice = parseFloat(basePrice) || 0;
                  const netWithDeposit3Yr = Math.max(0, bPrice - bDeposit);

                  return (
                    <div className="space-y-2 pt-1">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div className="p-2.5 bg-white rounded-lg border border-emerald-200">
                          <div className="text-[10px] text-slate-500 font-bold">🎯 ปีที่ 1 (ลด 10%{bDeposit > 0 ? ' + หักเงินจอง' : ''})</div>
                          <div className="text-xs font-black text-emerald-700 mt-0.5">
                            {netWithDeposit1Yr.toLocaleString()} บาท
                          </div>
                          <div className="text-[10px] text-emerald-600">
                            ลดราคา {calcResults.discount1YrAmount.toLocaleString()} บ.
                          </div>
                        </div>

                        <div className="p-2.5 bg-white rounded-lg border border-emerald-200">
                          <div className="text-[10px] text-slate-500 font-bold">🎯 ปีที่ 2 (ลด 5%{bDeposit > 0 ? ' + หักเงินจอง' : ''})</div>
                          <div className="text-xs font-black text-emerald-700 mt-0.5">
                            {netWithDeposit2Yr.toLocaleString()} บาท
                          </div>
                          <div className="text-[10px] text-emerald-600">
                            ลดราคา {calcResults.discount2YrAmount.toLocaleString()} บ.
                          </div>
                        </div>

                        <div className="p-2.5 bg-white rounded-lg border border-emerald-200">
                          <div className="text-[10px] text-slate-500 font-bold">🎯 ปีที่ 3 (ราคาปกติ{bDeposit > 0 ? ' + หักเงินจอง' : ''})</div>
                          <div className="text-xs font-black text-slate-800 mt-0.5">
                            {netWithDeposit3Yr.toLocaleString()} บาท
                          </div>
                          <div className="text-[10px] text-slate-500">
                            ดอกเบี้ย 0% (ตาม Base Price)
                          </div>
                        </div>
                      </div>

                      {/* 📈 เงื่อนไขผ่อนเกิน 3 ปี เข้าปีที่ 4 บวกดอกเบี้ย 8% */}
                      <div className="p-3 bg-amber-50/90 rounded-xl border border-amber-300 text-amber-950 space-y-2.5 text-xs">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1.5">
                          <div className="font-bold flex items-center gap-1.5 text-amber-900">
                            <span>📈 เงื่อนไขผ่อนเกิน 3 ปี (เข้าปีที่ 4 เป็นต้นไป):</span>
                            <span className="bg-amber-200 text-amber-900 font-black px-1.5 py-0.2 rounded text-[10px]">บวกดอกเบี้ย 8%</span>
                          </div>
                          <div className="text-[11px] text-amber-800">
                            งวดเดือนที่ 1 - 36 ผ่อนปกติ <b>{calcResults.monthlyRent.toLocaleString()} บ./ด.</b> (ดอกเบี้ย 0%)
                          </div>
                        </div>

                        {/* Input for Agreed Monthly Installment in Year 4 */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1 border-t border-amber-200/80 items-center">
                          <div>
                            <label htmlFor="rental-year4-agreed-rent" className="block text-amber-900 font-bold mb-1 text-[11px]">
                              ค่างวดที่ตกลงใหม่ปีที่ 4 (ก่อนดอกเบี้ย):
                            </label>
                            <div className="relative">
                              <input
                                id="rental-year4-agreed-rent"
                                type="number"
                                min="0"
                                step="500"
                                placeholder={monthlyRent || '15000'}
                                value={year4AgreedRent}
                                onChange={e => setYear4AgreedRent(e.target.value)}
                                className="w-full bg-white border border-amber-300 rounded-lg px-2.5 py-1.5 font-bold text-amber-950 focus:ring-2 focus:ring-amber-500 focus:outline-none text-xs"
                              />
                              <span className="absolute right-2.5 top-1.5 text-[11px] text-amber-700 pointer-events-none">บ./ด.</span>
                            </div>
                            <span className="text-[10px] text-amber-800 mt-0.5 block">
                              {year4AgreedRent ? `ปรับจากเดิม ${(parseFloat(monthlyRent) || 0).toLocaleString()} บ.` : 'ค่าเริ่มต้นเท่ากับค่างวดปกติ (สามารถปรับเพิ่มตามตกลง)'}
                            </span>
                          </div>

                          <div className="bg-white p-2.5 rounded-xl border border-amber-300 flex items-center justify-between shadow-2xs">
                            <div className="space-y-0.5">
                              <div className="text-[10px] text-amber-800 font-bold">ยอดผ่อนปีที่ 4 รวมดอกเบี้ย 8%:</div>
                              <div className="text-[10px] text-slate-500">
                                ({calcResults.year4BaseRent.toLocaleString()} + ดอกเบี้ย {calcResults.year4InterestAmount.toLocaleString()} บ.)
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-black text-amber-900 text-sm">
                                {calcResults.year4MonthlyRent.toLocaleString()}
                              </div>
                              <div className="text-[9px] text-amber-700">บาท/เดือน</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {durationMonths > 36 && (
                        <div className="p-2 bg-blue-50 border border-blue-200 text-blue-900 rounded-lg text-[11px] font-semibold flex items-center gap-1.5">
                          <span>📌 สัญญานี้มีระยะเวลา {durationMonths} เดือน: ตั้งแต่งวดเดือนที่ 37 เป็นต้นไป ค่าผ่อนจะปรับเป็น <b>{calcResults.year4MonthlyRent.toLocaleString()} บาท/เดือน</b> (ค่างวดตกลง {calcResults.year4BaseRent.toLocaleString()} บ. + ดอกเบี้ย 8%) ตามเงื่อนไข</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Total Initial Payment Summary */}
            <div className="p-3 bg-indigo-50/80 rounded-xl border border-indigo-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span className="font-bold text-indigo-900 text-xs">
                  ยอดรวมชำระวันทำสัญญา:
                </span>
                <p className="text-[11px] text-indigo-700 font-semibold mt-0.5">
                  {[
                    calcResults.securityDeposit > 0 ? `ประกัน ${depositMonths} ด. (${calcResults.securityDeposit.toLocaleString()} บ.)` : null,
                    hasAdvanceRent ? `ล่วงหน้า ${advanceRentMonths} ด. (${calcResults.advanceRent.toLocaleString()} บ.)` : null,
                    (selectedProgram === 'program_c' && calcResults.appliedContractFee > 0) ? `ค่าสัญญา (${calcResults.appliedContractFee.toLocaleString()} บ.)` : null
                  ].filter(Boolean).join(' + ') || '0 บาท'}
                </p>
                <p className="text-[10px] text-indigo-500 mt-0.5">เงินประกันจะได้รับคืนเมื่อสิ้นสุดสัญญาตามเงื่อนไข</p>
              </div>
              <div className="text-sm font-black text-indigo-700 bg-white px-3 py-1.5 rounded-xl border border-indigo-200 shadow-sm self-end sm:self-auto shrink-0">
                {calcResults.totalInitialPayment.toLocaleString()} บาท
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-slate-700 font-bold mb-1">หมายเหตุ / เงื่อนไขเพิ่มเติมในสัญญา</label>
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="เช่น มีสัตว์เลี้ยง 1 ตัว, แถมเฟอร์นิเจอร์ห้องนอน, กำหนดชำระค่าเช่าทุกวันที่ 5 ของเดือน..."
              className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 font-medium focus:ring-2 focus:ring-blue-500 focus:bg-white focus:outline-none"
            />
          </div>

          </fieldset>
          {/* Modal Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-50 cursor-pointer transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={submitting || loadingPlots}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-700 via-indigo-700 to-slate-900 hover:from-blue-800 hover:to-slate-950 text-white font-bold shadow-md shadow-indigo-700/20 cursor-pointer flex items-center gap-2 transition-all disabled:opacity-50"
            >
              <Key size={15} />
              {submitting ? 'กำลังบันทึกสัญญา...' : 'ยืนยันบันทึกสัญญาเช่า'}
            </button>
          </div>
        </form>
      </div>
    </SalesOverlay>
  );
}

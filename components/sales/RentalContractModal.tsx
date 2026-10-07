"use client";

import React, { useState, useEffect, useMemo } from 'react';
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
import { 
  Lead, 
  RentalProgramType, 
  RENTAL_PROGRAM_DETAILS, 
  RentalContract 
} from '@/types/sales';
import { calculateRentalTerms } from '@/lib/rentalHelper';
import LeadPicker from './LeadPicker';

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
  salesOwners = [],
  onSaved
}: RentalContractModalProps) {
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
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [customDeposit, setCustomDeposit] = useState<string>('30000');
  const [savingsPerMonth, setSavingsPerMonth] = useState<string>('5000');
  const [basePrice, setBasePrice] = useState<string>('2990000');
  const [agentName, setAgentName] = useState<string>('');
  const [ownerSource, setOwnerSource] = useState<'current_user' | 'manual'>('current_user');
  const [notes, setNotes] = useState<string>('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Handle lead selection from LeadPicker
  const handleLeadSelect = (chosenLead: any | null) => {
    setSelectedLead(chosenLead);
    if (chosenLead) {
      setTenantName(chosenLead.customer_name || '');
      setTenantPhone(chosenLead.phone || '');
      // Default closer is the logged in user (ID ปัจจุบัน)
      const defaultAgent = user?.displayName || user?.username || user?.name || salesOwners?.[0]?.displayName || 'ทีมขาย';
      setAgentName(defaultAgent);
      setOwnerSource('current_user');
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
      const defaultAgent = user?.displayName || user?.username || user?.name || salesOwners?.[0]?.displayName || 'ทีมขาย';
      setAgentName(defaultAgent);
      setOwnerSource('current_user');
    }
    if (plotId) {
      setSelectedPlotId(plotId);
    }
  }, [initialLead, plotId, user, salesOwners]);

  // Fetch available plots for the selected project
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
          setPlotsList(data);
          // If no plot selected yet or plot not in this project, pick the first available
          if (!selectedPlotId && data.length > 0) {
            const firstVacant = data.find(p => !p.has_customer && p.sale_status !== 'Reserved' && p.sale_status !== 'Transferred');
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
        console.error('Error loading plots for rental modal:', err);
      } finally {
        if (!isCancelled) setLoadingPlots(false);
      }
    };
    fetchPlots();
    return () => { isCancelled = true; };
  }, [isOpen, targetProject]);

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

  // Keep deposit in sync with monthly rent whenever rent changes
  useEffect(() => {
    const rentNum = parseFloat(monthlyRent) || 0;
    setCustomDeposit((rentNum * 2).toString());
  }, [monthlyRent]);

  // Calculate live financial calculations using helper
  const calcResults = useMemo(() => {
    const rentNum = parseFloat(monthlyRent) || 0;
    const depositNum = parseFloat(customDeposit) || 0;
    const savingsNum = parseFloat(savingsPerMonth) || 0;
    const priceNum = parseFloat(basePrice) || 0;

    return calculateRentalTerms({
      programType: selectedProgram,
      monthlyRent: rentNum,
      basePrice: priceNum,
      durationMonths,
      startDate,
      customDeposit: depositNum,
      customSavingsPerMonth: savingsNum
    });
  }, [selectedProgram, monthlyRent, customDeposit, savingsPerMonth, basePrice, durationMonths, startDate]);

  if (!isOpen) return null;

  const currentProgram = RENTAL_PROGRAM_DETAILS[selectedProgram];
  const selectedPlot = plotsList.find(p => p.id === selectedPlotId);
  const effectiveLead = selectedLead || initialLead;
  const leadOwnerName = effectiveLead?.agent_name || effectiveLead?.sales_owner || effectiveLead?.salesOwner || null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);

    try {
      if (!tenantName.trim()) throw new Error('กรุณาระบุชื่อผู้เช่า');
      if (!targetProject) throw new Error('กรุณาระบุโครงการ');
      if (!selectedPlotId) throw new Error('กรุณาเลือกแปลง/บ้านที่จะทำสัญญาเช่า');
      const rentNum = parseFloat(monthlyRent) || 0;
      if (rentNum <= 0) throw new Error('กรุณาระบุค่าเช่าต่อเดือนให้ถูกต้อง');

      const now = new Date().toISOString();
      const depositNum = parseFloat(customDeposit) || (rentNum * 2);
      const savingsNum = selectedProgram === 'program_b' ? (parseFloat(savingsPerMonth) || 5000) : 0;
      const priceNum = selectedProgram === 'program_c' ? (parseFloat(basePrice) || 0) : 0;

      const effectiveLead = selectedLead || initialLead;
      let targetLeadId = effectiveLead?.id || null;

      const crmStatus = selectedProgram === 'program_b' 
        ? 'Rent-to-Own / Active — สัญญาเช่าซื้อ/เช่าออม (สะสมเงินดาวน์)'
        : 'Rented / Active — ทำสัญญาเช่าแล้ว (อยู่ระหว่างเช่า)';

      // 1. If Walk-in (no existing lead), create Lead first to get lead_id
      if (!targetLeadId) {
        const { data: newLeadData, error: newLeadErr } = await supabase
          .from('leads')
          .insert([{
            customer_name: tenantName.trim(),
            phone: tenantPhone.trim(),
            project_name: targetProject,
            channel: 'Walk in',
            source: 'Walk in',
            agent_name: agentName.trim() || 'ทีมขาย',
            created_by_agent: agentName.trim() || 'ทีมขาย',
            deal_type: 'rent',
            rental_program: selectedProgram,
            crm_status: crmStatus,
            interested_plot_id: selectedPlotId,
            interested_plot_name: selectedPlot?.plot_name || selectedPlotId,
            rental_monthly_rent: rentNum,
            rental_deposit: depositNum,
            rental_savings_per_month: savingsNum,
            rental_base_price: priceNum,
            rental_start_date: startDate,
            rental_end_date: calcResults.endDate,
            rental_status: 'Active',
            notes: notes.trim() || null,
            created_at: now
          }])
          .select('id')
          .single();

        if (newLeadErr) {
          console.warn('Could not create walk-in lead:', newLeadErr);
        } else if (newLeadData?.id) {
          targetLeadId = newLeadData.id;
        }
      }

      // 2. Create Record in rental_contracts
      const contractPayload: Partial<RentalContract> = {
        lead_id: targetLeadId,
        project_name: targetProject,
        plot_id: selectedPlotId,
        plot_name: selectedPlot?.plot_name || selectedPlotId,
        tenant_name: tenantName.trim(),
        tenant_phone: tenantPhone.trim() || null,
        agent_name: agentName.trim() || 'ทีมขาย',
        program_type: selectedProgram,
        monthly_rent: rentNum,
        security_deposit: depositNum,
        advance_rent: rentNum,
        savings_per_month: savingsNum,
        accumulated_savings: 0,
        base_price: priceNum,
        discount_1yr_pct: 10.0,
        discount_2yr_pct: 5.0,
        lease_duration_months: durationMonths,
        lease_start_date: startDate,
        lease_end_date: calcResults.endDate,
        status: 'Active',
        notes: notes.trim() || null,
        created_at: now,
        updated_at: now
      };

      const { data: contractData, error: contractErr } = await supabase
        .from('rental_contracts')
        .insert([contractPayload])
        .select('id')
        .single();

      if (contractErr) {
        console.warn('Could not insert to rental_contracts (table might be newly created):', contractErr);
      }

      const contractId = contractData?.id || null;

      // 3. Update Lead with active_rental_contract_id
      if (targetLeadId) {
        await supabase
          .from('leads')
          .update({
            deal_type: 'rent',
            rental_program: selectedProgram,
            crm_status: crmStatus,
            interested_plot_id: selectedPlotId,
            interested_plot_name: selectedPlot?.plot_name || selectedPlotId,
            rental_monthly_rent: rentNum,
            rental_deposit: depositNum,
            rental_savings_per_month: savingsNum,
            rental_base_price: priceNum,
            rental_start_date: startDate,
            rental_end_date: calcResults.endDate,
            rental_status: 'Active',
            active_rental_contract_id: contractId,
            notes: notes ? `${effectiveLead?.notes || ''}\n[สัญญาเช่า ${currentProgram.name}]: ${notes}`.trim() : effectiveLead?.notes
          })
          .eq('id', targetLeadId);
      }

      // 4. Update Plot Table
      const { error: plotErr } = await supabase
        .from('plots')
        .update({
          sale_status: 'Rented',
          has_customer: true,
          current_tenant_name: tenantName.trim(),
          current_tenant_phone: tenantPhone.trim() || null,
          rental_program: selectedProgram,
          monthly_rent: rentNum,
          security_deposit: depositNum,
          lease_start_date: startDate,
          lease_end_date: calcResults.endDate,
          highlight_note: `เช่า: ${currentProgram.name} (${tenantName.trim()})`
        })
        .eq('id', selectedPlotId);

      if (plotErr) {
        console.warn('Plot update notice:', plotErr);
      }

      if (onSaved) onSaved();
      onClose();
    } catch (err: any) {
      console.error('Error saving rental contract:', err);
      setErrorMsg(err.message || 'บันทึกสัญญาเช่าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto animate-fade-in">
      <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-auto flex flex-col max-h-[90vh]">
        
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
                  const defaultAgent = user?.displayName || user?.username || user?.name || salesOwners?.[0]?.displayName || 'ทีมขาย';
                  setAgentName(defaultAgent);
                  setOwnerSource('current_user');
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
                  <option value="">-- เลือกแปลงบ้าน --</option>
                  {plotsList.map(p => {
                    const isTaken = p.has_customer && p.id !== (selectedLead?.interested_plot_id || plotId);
                    const tag = p.sale_status === 'Rented' ? '🔵 มีผู้เช่า' : (p.has_customer ? '🔴 ไม่ว่าง' : '🟢 ว่าง');
                    return (
                      <option key={p.id} value={p.id} disabled={isTaken}>
                        {p.plot_name || p.id} ({tag}) {p.price ? `- ${Number(p.price).toLocaleString()} บ.` : ''}
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
                    {agentName && !salesOwners.some(o => o.displayName === agentName) && (
                      <option value={agentName}>{agentName}</option>
                    )}
                    {salesOwners.map(o => (
                      <option key={o.userId} value={o.displayName}>{o.displayName}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={agentName}
                    onChange={e => {
                      setAgentName(e.target.value);
                      setOwnerSource('manual');
                    }}
                    placeholder="เช่น คุณสมชาย (ทีมขาย)"
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-2xs"
                  />
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

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-slate-700 font-bold mb-1">ค่าเช่าต่อเดือน (บาท) *</label>
                <input
                  type="number"
                  required
                  min="0"
                  step="500"
                  value={monthlyRent}
                  onChange={e => setMonthlyRent(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-black text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">ระยะเวลาสัญญาเช่า (เดือน)</label>
                <select
                  value={durationMonths}
                  onChange={e => setDurationMonths(parseInt(e.target.value) || 12)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-bold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  <option value={12}>12 เดือน (1 ปี - ขั้นต่ำ)</option>
                  <option value={24}>24 เดือน (2 ปี)</option>
                  <option value={36}>36 เดือน (3 ปี)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">วันเริ่มต้นสัญญา *</label>
                <input
                  type="date"
                  required
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">เงินประกันบ้าน 2 เดือน (บาท)</label>
                <input
                  type="number"
                  min="0"
                  value={customDeposit}
                  onChange={e => setCustomDeposit(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-bold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
                <span className="text-[10px] text-slate-500 mt-0.5 block">คำนวณอัตโนมัติ 2 เดือน</span>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">ค่าเช่าล่วงหน้า 1 เดือน (บาท)</label>
                <div className="w-full bg-slate-200/70 border border-slate-300 rounded-xl px-3 py-2 font-bold text-slate-700">
                  {calcResults.advanceRent.toLocaleString()} บาท
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">วันสิ้นสุดสัญญา (คำนวณ)</label>
                <div className="w-full bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 font-bold text-blue-800 flex items-center gap-1">
                  <Calendar size={13} /> {calcResults.endDate}
                </div>
              </div>
            </div>

            {/* Program B Specific: Savings per month */}
            {selectedProgram === 'program_b' && (
              <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-200 space-y-2 animate-fade-in">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-900 text-xs flex items-center gap-1">
                    <PiggyBank size={15} className="text-amber-600" /> เงินสะสมเพื่อซื้อบ้านรายเดือน (Program B)
                  </span>
                  <span className="text-[11px] bg-amber-200 text-amber-900 font-black px-2 py-0.5 rounded-full">
                    สะสมปีละ {calcResults.projected1YrSavings.toLocaleString()} บาท
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-amber-800 font-bold mb-1">เงินสะสมรายเดือน (บาท/เดือน)</label>
                    <input
                      type="number"
                      min="0"
                      step="500"
                      value={savingsPerMonth}
                      onChange={e => setSavingsPerMonth(e.target.value)}
                      className="w-full bg-white border border-amber-300 rounded-xl px-3 py-2 font-black text-amber-950 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-col justify-center text-[11px] text-amber-800">
                    <div>• ชำระรวมต่อเดือน = <b>{(calcResults.monthlyRent + calcResults.savingsPerMonth).toLocaleString()} บาท</b></div>
                    <div>• เมื่อตัดสินใจโอนกรรมสิทธิ์ <b>หักเงินสะสมจริงจากราคาบ้าน</b></div>
                  </div>
                </div>
              </div>
            )}

            {/* Program C Specific: Base Price & Discounts */}
            {selectedProgram === 'program_c' && (
              <div className="p-3.5 bg-emerald-50 rounded-xl border border-emerald-200 space-y-2.5 animate-fade-in">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-900 text-xs flex items-center gap-1">
                    <Percent size={15} className="text-emerald-600" /> ราคาฐาน & สิทธิ์ส่วนลดการโอน (Program C)
                  </span>
                  <span className="text-[11px] bg-emerald-200 text-emerald-900 font-black px-2 py-0.5 rounded-full">
                    Rent and Save
                  </span>
                </div>

                <div>
                  <label className="block text-emerald-800 font-bold mb-1">ราคาตั้ง / Base Price (บาท)</label>
                  <input
                    type="number"
                    min="0"
                    step="10000"
                    value={basePrice}
                    onChange={e => setBasePrice(e.target.value)}
                    className="w-full bg-white border border-emerald-300 rounded-xl px-3 py-2 font-black text-emerald-950 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div className="p-2.5 bg-white rounded-lg border border-emerald-200">
                    <div className="text-[10px] text-slate-500 font-bold">🎯 โอนภายใน 1 ปี (ลด 10%)</div>
                    <div className="text-xs font-black text-emerald-700 mt-0.5">
                      {calcResults.netPrice1Yr.toLocaleString()} บาท
                    </div>
                    <div className="text-[10px] text-emerald-600">ประหยัด {calcResults.discount1YrAmount.toLocaleString()} บ.</div>
                  </div>

                  <div className="p-2.5 bg-white rounded-lg border border-emerald-200">
                    <div className="text-[10px] text-slate-500 font-bold">🎯 โอนภายใน 2 ปี (ลด 5%)</div>
                    <div className="text-xs font-black text-emerald-700 mt-0.5">
                      {calcResults.netPrice2Yr.toLocaleString()} บาท
                    </div>
                    <div className="text-[10px] text-emerald-600">ประหยัด {calcResults.discount2YrAmount.toLocaleString()} บ.</div>
                  </div>
                </div>
              </div>
            )}

            {/* Total Initial Payment Summary */}
            <div className="p-3 bg-indigo-50/80 rounded-xl border border-indigo-100 flex items-center justify-between">
              <div>
                <span className="font-bold text-indigo-900 text-xs">ยอดรวมชำระวันทำสัญญา (ประกัน 2 ด. + ล่วงหน้า 1 ด.):</span>
                <p className="text-[10px] text-indigo-600 mt-0.5">เงินประกันจะได้รับคืนเมื่อสิ้นสุดสัญญาตามเงื่อนไข</p>
              </div>
              <div className="text-sm font-black text-indigo-700 bg-white px-3 py-1.5 rounded-xl border border-indigo-200 shadow-sm">
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
              disabled={submitting}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-700 via-indigo-700 to-slate-900 hover:from-blue-800 hover:to-slate-950 text-white font-bold shadow-md shadow-indigo-700/20 cursor-pointer flex items-center gap-2 transition-all disabled:opacity-50"
            >
              <Key size={15} />
              {submitting ? 'กำลังบันทึกสัญญา...' : 'ยืนยันบันทึกสัญญาเช่า'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

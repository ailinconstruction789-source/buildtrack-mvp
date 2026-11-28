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
  Plus,
  BookmarkCheck,
  FileText,
  Receipt
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { canEditSalesRole, getLeadStage } from '@/lib/sales/leadStage';
import { classifySalesDeal } from '@/lib/sales/dealClassification';
import {
  classifyPlotOccupancy,
  type PlotRentalContractSnapshot,
  type PlotSaleSnapshot,
} from '@/lib/sales/plotAvailability';
import {
  bookRentalTx,
  createTxRequestId,
  signRentalContractTx,
  translateSalesTxError,
} from '@/lib/sales/rentalTxClient';
import { selectSalesStaffName } from '@/lib/sales/salesStaff';
import { useSalesStaffOptions } from '@/hooks/useSalesStaffOptions';
import { 
  Lead, 
  RentalProgramType, 
  RENTAL_PROGRAM_DETAILS, 
} from '@/types/sales';
import { calculateRentalTerms, parseRentalInceptionDetails } from '@/lib/rentalHelper';
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
  defaultMode?: 'booking' | 'contract';
}

function checkLeadPlotOwnership(targetLead: any, plotItem: any, _activePlotId?: string | null): boolean {
  if (!targetLead || !plotItem) return false;

  // 1. Project scope check: lead and plot must belong to the same project if specified
  if (plotItem.project_name && targetLead.project_name) {
    const cleanProject = (p: string) => p.trim().toLowerCase();
    if (cleanProject(plotItem.project_name) !== cleanProject(targetLead.project_name)) {
      return false;
    }
  }

  // 2. Exact lead ID conflict check: if plot already points to a different lead ID, reject
  const targetLeadId = targetLead.leadId || targetLead.id;
  if (plotItem.lead_id && targetLeadId && plotItem.lead_id !== targetLeadId) {
    return false;
  }

  // 3. Customer name mismatch check: cannot claim plot if it explicitly names a different customer/tenant
  const clean = (val: unknown) =>
    typeof val === 'string' ? val.trim().toLowerCase().replace(/^(นาย|นาง|นางสาว|คุณ)\s*/, '') : '';
  const leadCustName = clean(targetLead.customer_name || targetLead.name);
  const plotCustName = clean(plotItem.customer_name);
  const plotTenantName = clean(plotItem.current_tenant_name);
  const matchesPlotCustomerName = Boolean(leadCustName && ((plotCustName && plotCustName === leadCustName) || (plotTenantName && plotTenantName === leadCustName)));

  if (plotCustName && leadCustName && plotCustName !== leadCustName) {
    return false;
  }
  if (plotTenantName && leadCustName && plotTenantName !== leadCustName) {
    return false;
  }

  // 4. Target lead must currently hold an active booking or rental contract
  // Note: Historical booking_date or booking_amount without current active status is NOT current authority!
  const stage = getLeadStage(targetLead);
  const rawStatus = String(targetLead.status || '').toLowerCase().trim();
  const rawRentalStatus = String(targetLead.rental_status || '').toLowerCase().trim();
  const leadHoldsActiveBookingOrContract = Boolean(
    stage === 'booked' ||
    stage === 'rented' ||
    ['booked', 'reserved', 'rented'].includes(rawStatus) ||
    ['active', 'pendingcontract', 'renewed'].includes(rawRentalStatus)
  );

  if (!leadHoldsActiveBookingOrContract) {
    return false;
  }

  // 5. Must have verified linkage between targetLead and THIS plotItem
  const leadPlotId = targetLead.interested_plot_id || targetLead.plotId || targetLead.plot;
  const leadPlotName = targetLead.interested_plot_name || targetLead.interestedPlotName || targetLead.plotName;

  const matchesLeadPlot = Boolean(
    (leadPlotId && (plotItem.id === leadPlotId || plotItem.plot_name === leadPlotId)) ||
    (leadPlotName && (plotItem.plot_name === leadPlotName || plotItem.id === leadPlotName))
  );
  const matchesPlotLeadId = Boolean(plotItem.lead_id && targetLeadId && plotItem.lead_id === targetLeadId);

  // If the plot is booked, reserved, rented, or has a customer:
  // It cannot be claimed by interested_plot_id alone without explicit lead_id match or matching customer/tenant name.
  // Concurrently, coincidental name match is guarded against in handleSubmit via database table ownership checks.
  const isPlotCommitted = Boolean(
    (plotItem.sale_status && !['available', 'ว่าง'].includes(String(plotItem.sale_status).toLowerCase())) ||
    plotItem.has_customer ||
    plotCustName ||
    plotTenantName ||
    plotItem.lead_id
  );

  if (isPlotCommitted) {
    if (plotItem.lead_id && targetLeadId) {
      return plotItem.lead_id === targetLeadId;
    }
    return matchesPlotCustomerName && matchesLeadPlot;
  }

  return matchesPlotLeadId || matchesPlotCustomerName || matchesLeadPlot;
}

export default function RentalContractModal({
  isOpen,
  onClose,
  lead: initialLead,
  plotId,
  projectName = 'ไอลิน สันทราย 2',
  user,
  salesOwners: providedSalesOwners,
  onSaved,
  defaultMode
}: RentalContractModalProps) {
  const salesOwners = useSalesStaffOptions(isOpen, providedSalesOwners, String(user?.id ?? user?.username ?? ''));
  const [selectedLead, setSelectedLead] = useState<any | null>(initialLead || null);
  const [isNewLeadMode, setIsNewLeadMode] = useState(false);
  const [selectedProgram, setSelectedProgram] = useState<RentalProgramType>('program_a');
  const [targetProject, setTargetProject] = useState<string>(initialLead?.project_name || projectName);
  const [selectedPlotId, setSelectedPlotId] = useState<string>(
    plotId || initialLead?.interested_plot_id || (initialLead as any)?.plotId || (initialLead as any)?.plot || ''
  );
  const [plotsList, setPlotsList] = useState<any[]>([]);
  const [projectSalesList, setProjectSalesList] = useState<PlotSaleSnapshot[]>([]);
  const [projectRentalsList, setProjectRentalsList] = useState<PlotRentalContractSnapshot[]>([]);
  const [loadingPlots, setLoadingPlots] = useState(false);

  // Form Fields
  const [tenantName, setTenantName] = useState<string>(initialLead?.customer_name || (initialLead as any)?.name || '');
  const [tenantPhone, setTenantPhone] = useState<string>(initialLead?.phone || '');
  const [monthlyRent, setMonthlyRent] = useState<string>(() => {
    const raw = initialLead?.rental_monthly_rent;
    return raw !== undefined && raw !== null ? String(raw) : '15000';
  });
  const [durationMonths, setDurationMonths] = useState<number>(12);
  const [bookingDate, setBookingDate] = useState<string>(() => {
    const anyLead = initialLead as any;
    const raw = initialLead?.booking_date || anyLead?.bookingDate || anyLead?.booked_at || anyLead?.bookedAt;
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
    if (raw) return String(raw).split('T')[0];
    const isBooking = defaultMode === 'booking';
    return isBooking ? '' : new Date().toISOString().split('T')[0];
  });
  const [customDeposit, setCustomDeposit] = useState<string>(() => {
    const raw = initialLead?.rental_deposit;
    return raw !== undefined && raw !== null ? String(raw) : '30000';
  });
  const [depositMonths, setDepositMonths] = useState<number>(2);
  const [hasAdvanceRent, setHasAdvanceRent] = useState<boolean>(true);
  const [advanceRentMonths, setAdvanceRentMonths] = useState<number>(1);
  const [contractFee, setContractFee] = useState<string>(() => {
    const inception = parseRentalInceptionDetails(initialLead);
    if (inception.contractFee !== null && inception.contractFee !== undefined && inception.contractFee > 0) {
      return String(inception.contractFee);
    }
    const rawFee = (initialLead as any)?.rental_contract_fee || (initialLead as any)?.contract_fee;
    if (rawFee !== undefined && rawFee !== null && Number(rawFee) > 0) return String(rawFee);
    return '20000';
  });
  const [year4AgreedRent, setYear4AgreedRent] = useState<string>('');
  const [savingsPerMonth, setSavingsPerMonth] = useState<string>(() => {
    const raw = initialLead?.rental_savings_per_month;
    return raw !== undefined && raw !== null ? String(raw) : '5000';
  });
  const [basePrice, setBasePrice] = useState<string>(() => {
    const raw = initialLead?.rental_base_price;
    return raw !== undefined && raw !== null ? String(raw) : '2990000';
  });
  const [agentName, setAgentName] = useState<string>(() => {
    const anyLead = initialLead as any;
    const leadSales = initialLead?.agent_name || anyLead?.agentName || initialLead?.sales_owner || anyLead?.salesOwner || initialLead?.created_by_agent;
    if (leadSales) return leadSales;
    return selectSalesStaffName(providedSalesOwners || [], [user?.displayName, user?.username, user?.name]);
  });
  const [ownerSource, setOwnerSource] = useState<'lead_owner' | 'current_user' | 'manual'>(() => {
    const anyLead = initialLead as any;
    const leadSales = initialLead?.agent_name || anyLead?.agentName || initialLead?.sales_owner || anyLead?.salesOwner || initialLead?.created_by_agent;
    if (leadSales) return 'lead_owner';
    const def = selectSalesStaffName(providedSalesOwners || [], [user?.displayName, user?.username, user?.name]);
    return def ? 'current_user' : 'manual';
  });
  const [notes, setNotes] = useState<string>('');
  const [actionMode, setActionMode] = useState<'booking' | 'contract'>(defaultMode || 'contract');

  useEffect(() => {
    if (defaultMode) {
      setActionMode(defaultMode);
    } else if (initialLead && classifySalesDeal(initialLead).isRentalPending) {
      setActionMode('contract');
    }
  }, [defaultMode, initialLead, isOpen]);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const pendingSubmitRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const busy = useRef(false);
  const scope = `${isOpen}:${initialLead?.id || ''}:${plotId || ''}:${user?.id || user?.username || ''}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => {
    pendingSubmitRef.current = null;
    busy.current = false;
    setSubmitting(false);
    setErrorMsg(null);
  }, [scope]);


  // Handle lead selection from LeadPicker
  const handleLeadSelect = (chosenLead: any | null) => {
    setSelectedLead(chosenLead);
    if (chosenLead) {
      setTenantName(chosenLead.customer_name || chosenLead.name || '');
      setTenantPhone(chosenLead.phone || '');
      
      // ดึงชื่อเซลล์เดิมที่ดูแลลูกค้าคนนี้ขึ้นมาเป็นค่าเริ่มต้นโดยอัตโนมัติ
      const leadSalesCandidates = [
        chosenLead.agent_name,
        chosenLead.agentName,
        chosenLead.sales_owner,
        chosenLead.salesOwner,
        chosenLead.created_by_agent,
        chosenLead.closing_agent,
        chosenLead.assigned_to
      ].filter((x): x is string => typeof x === 'string' && x.trim().length > 0);

      const matchedOwner = salesOwners.find(o => 
        leadSalesCandidates.some(c => 
          o.displayName.trim().toLowerCase() === c.trim().toLowerCase() ||
          o.userId.trim().toLowerCase() === c.trim().toLowerCase()
        )
      );

      if (matchedOwner) {
        setAgentName(matchedOwner.displayName);
        setOwnerSource('lead_owner');
      } else if (leadSalesCandidates.length > 0) {
        setAgentName(leadSalesCandidates[0]);
        setOwnerSource('lead_owner');
      } else {
        const defaultAgent = selectSalesStaffName(salesOwners, [user?.displayName, user?.username, user?.name]);
        setAgentName(defaultAgent);
        setOwnerSource(defaultAgent && [user?.displayName, user?.username, user?.name].includes(defaultAgent) ? 'current_user' : 'manual');
      }
      if (chosenLead.project_name) {
        setTargetProject(chosenLead.project_name);
      }
      const chosenPlotId = chosenLead.interested_plot_id || chosenLead.plotId || chosenLead.plot;
      if (chosenPlotId && !plotId) {
        setSelectedPlotId(chosenPlotId);
      }
      if (chosenLead.rental_program) {
        setSelectedProgram(chosenLead.rental_program);
      }
      if (chosenLead.rental_monthly_rent) {
        setMonthlyRent(chosenLead.rental_monthly_rent.toString());
      }
      const rawBooking = chosenLead.booking_date || chosenLead.bookingDate || chosenLead.booked_at || chosenLead.bookedAt;
      if (rawBooking) {
        setBookingDate(String(rawBooking).split('T')[0]);
      }
      if (chosenLead.booking_amount !== undefined && chosenLead.booking_amount !== null) {
        setBookingAmount(chosenLead.booking_amount.toString());
      }
      if (chosenLead.contracted_at || chosenLead.contract_date) {
        setContractDate(String(chosenLead.contracted_at || chosenLead.contract_date).split('T')[0]);
      }
      if (chosenLead.rental_start_date) {
        setStartDate(String(chosenLead.rental_start_date).split('T')[0]);
      } else {
        const isBooking = defaultMode ? defaultMode === 'booking' : actionMode === 'booking';
        if (isBooking) {
          setStartDate('');
        }
      }

      // Sync inception financial details (Contract Fee, Booking Amount, Deposit) from notes or lead
      const inception = parseRentalInceptionDetails(chosenLead);
      if (inception.contractFee !== null && inception.contractFee !== undefined && inception.contractFee > 0) {
        setContractFee(inception.contractFee.toString());
      } else if (chosenLead.rental_program === 'program_c') {
        setContractFee('20000');
      }
      if (inception.bookingAmount !== null && inception.bookingAmount !== undefined && inception.bookingAmount > 0) {
        setBookingAmount(inception.bookingAmount.toString());
      }
      if (inception.bookingDate) {
        setBookingDate(inception.bookingDate);
      }
      if (inception.securityDeposit !== null && inception.securityDeposit !== undefined && inception.securityDeposit > 0) {
        setCustomDeposit(inception.securityDeposit.toString());
      }
      setIsNewLeadMode(false);
    } else {
      if (!isNewLeadMode) {
        setTenantName('');
        setTenantPhone('');
      }
    }
  };

  // Track synced lead ID to avoid re-syncing and overwriting user typing when salesOwners or user re-render
  const lastSyncedLeadId = useRef<string | null>(null);

  // Sync initial props once per lead/plot
  useEffect(() => {
    if (!isOpen) {
      lastSyncedLeadId.current = null;
      return;
    }
    const currentLeadId = initialLead?.id || (initialLead ? 'lead-init' : null);
    if (initialLead && lastSyncedLeadId.current !== currentLeadId) {
      lastSyncedLeadId.current = currentLeadId;
      handleLeadSelect(initialLead);
    }
    if (plotId && !selectedPlotId) {
      setSelectedPlotId(plotId);
    }
  }, [isOpen, initialLead?.id, plotId]);

  // Sync default agent only once when salesOwners are available and agentName is not yet set
  useEffect(() => {
    const anyLead = initialLead as any;
    const hasLeadSales = Boolean(initialLead?.agent_name || anyLead?.agentName || initialLead?.sales_owner || anyLead?.salesOwner || initialLead?.created_by_agent);
    if (isOpen && !hasLeadSales && !agentName && salesOwners.length > 0) {
      const defaultAgent = selectSalesStaffName(salesOwners, [user?.displayName, user?.username, user?.name]);
      if (defaultAgent) {
        setAgentName(defaultAgent);
        setOwnerSource([user?.displayName, user?.username, user?.name].includes(defaultAgent) ? 'current_user' : 'manual');
      }
    }
  }, [isOpen, initialLead, salesOwners, agentName, user]);

  // Fetch available plots (+ sales & rental_contracts occupancy) for the selected project & sort naturally
  useEffect(() => {
    if (!isOpen) return;
    let isCancelled = false;
    const fetchPlots = async () => {
      setLoadingPlots(true);
      try {
        const [plotsRes, rentalsRes] = await Promise.all([
          supabase.from('plots').select('*').eq('project_name', targetProject),
          supabase.from('rental_contracts').select('id, plot_id, status').eq('project_name', targetProject),
        ]);

        if (plotsRes.error) throw plotsRes.error;
        if (rentalsRes.error) throw rentalsRes.error;

        const data = plotsRes.data || [];
        const rentalsData = (rentalsRes.data || []) as PlotRentalContractSnapshot[];
        const plotIds = data.map((p: any) => p.id).filter(Boolean);

        let salesData: PlotSaleSnapshot[] = [];
        if (plotIds.length > 0) {
          const salesQuery: any = supabase.from('sales').select('id, plot_id, contract_status, crm_stage');
          const salesRes = typeof salesQuery.in === 'function'
            ? await salesQuery.in('plot_id', plotIds)
            : await salesQuery;
          if (salesRes?.error) throw salesRes.error;
          salesData = Array.isArray(salesRes?.data) ? (salesRes.data as PlotSaleSnapshot[]) : [];
        }

        if (!isCancelled) {
          // Sort plots naturally by numeric plot number (e.g. 1, 2, 3... 10, 11)
          const sorted = [...data].sort((a, b) => {
            const nameA = a.plot_name || a.id || '';
            const nameB = b.plot_name || b.id || '';
            return nameA.localeCompare(nameB, 'th', { numeric: true, sensitivity: 'base' });
          });
          setPlotsList(sorted);
          setProjectSalesList(salesData);
          setProjectRentalsList(rentalsData);

          // If a plot is already selected (or plotId passed), sync price/rent from DB if not provided by lead
          const anyInitLead = initialLead as any;
          const targetKey =
            selectedPlotId ||
            plotId ||
            initialLead?.interested_plot_id ||
            anyInitLead?.plotId ||
            anyInitLead?.plot ||
            initialLead?.interested_plot_name ||
            anyInitLead?.plotName;
          const activePlot = sorted.find(p => p.id === targetKey || p.plot_name === targetKey);
          if (activePlot) {
            if (selectedPlotId !== activePlot.id) {
              setSelectedPlotId(activePlot.id);
            }
            const priceVal = activePlot.selling_price || activePlot.base_price || activePlot.price;
            if (priceVal && !initialLead?.rental_base_price) {
              setBasePrice(priceVal.toString());
            }
            if (activePlot.monthly_rent && !initialLead?.rental_monthly_rent) {
              setMonthlyRent(activePlot.monthly_rent.toString());
            }
          } else if (!selectedPlotId && sorted.length > 0) {
            // If no plot selected yet or plot not in this project, pick the first canonically vacant plot
            const firstVacant = sorted.find(p =>
              classifyPlotOccupancy({
                plot: p,
                sales: salesData.filter(s => s.plot_id === p.id),
                rentalContracts: rentalsData.filter(r => r.plot_id === p.id),
              }).isAvailable
            );
            if (firstVacant) {
              setSelectedPlotId(firstVacant.id);
              const priceVal = firstVacant.selling_price || firstVacant.base_price || firstVacant.price;
              if (priceVal && !initialLead?.rental_base_price) {
                setBasePrice(priceVal.toString());
              }
              if (firstVacant.monthly_rent && !initialLead?.rental_monthly_rent) {
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

  // Filter and naturally sort plots for the dropdown using unified plot occupancy rules:
  // - Keep current customer's verified plot
  // - Otherwise show ONLY canonically available plots (excludes PendingContract, Active/Renewed, active sales, legacy occupied, unknown)
  const availableAndBookedPlots = useMemo(() => {
    return [...plotsList]
      .filter(p => {
        const activeLead = isNewLeadMode ? null : (selectedLead || initialLead);
        const isMyPlot = checkLeadPlotOwnership(activeLead, p, selectedPlotId || plotId);
        if (isMyPlot) return true;
        return classifyPlotOccupancy({
          plot: p,
          sales: projectSalesList.filter(s => s.plot_id === p.id),
          rentalContracts: projectRentalsList.filter(r => r.plot_id === p.id),
        }).isAvailable;
      })
      .sort((a, b) => {
        const nameA = a.plot_name || a.id || '';
        const nameB = b.plot_name || b.id || '';
        return nameA.localeCompare(nameB, 'th', { numeric: true, sensitivity: 'base' });
      });
  }, [plotsList, projectSalesList, projectRentalsList, selectedPlotId, selectedLead, initialLead, isNewLeadMode, plotId]);

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
  const leadOwnerName = effectiveLead?.agent_name || effectiveLead?.agentName || effectiveLead?.sales_owner || effectiveLead?.salesOwner || effectiveLead?.created_by_agent || effectiveLead?.closing_agent || null;

  const priorBookingAmount = effectiveLead?.booking_amount !== undefined && effectiveLead?.booking_amount !== null
    ? Number(effectiveLead.booking_amount)
    : null;
  const anyEffective = effectiveLead as any;
  const rawPriorBookingDate = effectiveLead?.booking_date || anyEffective?.bookingDate || anyEffective?.booked_at || anyEffective?.bookedAt;
  const priorBookingDate = rawPriorBookingDate
    ? String(rawPriorBookingDate).split('T')[0]
    : null;
  const priorMonthlyRent = effectiveLead?.rental_monthly_rent !== undefined && effectiveLead?.rental_monthly_rent !== null
    ? Number(effectiveLead.rental_monthly_rent)
    : null;
  const priorStartDate = effectiveLead?.rental_start_date
    ? String(effectiveLead.rental_start_date).split('T')[0]
    : null;
  const priorPlotName =
    effectiveLead?.interested_plot_name ||
    (effectiveLead as any)?.plotName ||
    effectiveLead?.interested_plot_id ||
    (effectiveLead as any)?.plot ||
    null;
  const priorProgram = effectiveLead?.rental_program
    ? (RENTAL_PROGRAM_DETAILS[effectiveLead.rental_program as RentalProgramType]?.name || effectiveLead.rental_program)
    : null;
  const priorAgent = effectiveLead?.agent_name || (effectiveLead as any)?.agentName || effectiveLead?.sales_owner || (effectiveLead as any)?.salesOwner || effectiveLead?.created_by_agent || null;

  const hasPriorBooking = Boolean(
    !isNewLeadMode &&
    effectiveLead &&
    (priorBookingAmount !== null || priorBookingDate !== null || priorMonthlyRent !== null || priorStartDate !== null || effectiveLead.status === 'Reserved' || (effectiveLead.crm_status && (effectiveLead.crm_status.includes('จอง') || effectiveLead.crm_status.includes('Booked'))))
  );

  const canWriteRental = user?.role != null ? canEditSalesRole(user.role) : true;

  const getOrCreateSubmitRequestId = (fingerprint: string): string => {
    if (pendingSubmitRef.current && pendingSubmitRef.current.fingerprint === fingerprint) {
      return pendingSubmitRef.current.requestId;
    }
    const nextId = createTxRequestId();
    pendingSubmitRef.current = { fingerprint, requestId: nextId };
    return nextId;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy.current || loadingPlots) return;
    if (!canWriteRental) {
      setErrorMsg('บัญชีของคุณมีสิทธิ์ดูข้อมูลอย่างเดียว ไม่สามารถบันทึกการจองเช่าหรือทำสัญญาเช่าได้');
      return;
    }
    const candidateLead = isNewLeadMode ? null : selectedLead || initialLead;
    if (candidateLead) {
      const candidateDeal = classifySalesDeal(candidateLead);
      if (candidateDeal.isConflict) {
        setErrorMsg('ข้อมูลสถานะดีลของลูกค้าขัดแย้ง กรุณาตรวจสอบข้อมูลก่อนบันทึกสัญญาเช่า');
        return;
      }
      if (candidateDeal.isRentalActive) {
        setErrorMsg('ลูกค้ารายนี้อยู่ในขั้นตอนจอง/สัญญาเช่าที่ใช้งานอยู่แล้ว ไม่สามารถสร้างสัญญาเช่าซ้ำได้');
        return;
      }
    }
    const requestScope = currentScope.current;
    if (salesOwners.length > 0 && !salesOwners.some(owner => owner.displayName === agentName) && agentName !== leadOwnerName) {
      setErrorMsg('กรุณาเลือกพนักงานฝ่ายขาย');
      return;
    }
    if (!agentName.trim()) {
      setErrorMsg('กรุณาระบุพนักงานฝ่ายขาย');
      return;
    }
    setErrorMsg(null);
    setSubmitting(true);
    busy.current = true;
    try {
      const effectiveLead = isNewLeadMode ? null : selectedLead || initialLead;
      if (!tenantName.trim()) throw new Error('กรุณาระบุชื่อผู้เช่า');
      if (!targetProject || !selectedPlotId) throw new Error('กรุณาเลือกโครงการและแปลงที่จะดำเนินการ');

      // Resolve selectedPlotId to canonical plot record in the selected project
      let resolvedPlot = plotsList.find(p => p.id === selectedPlotId || p.plot_name === selectedPlotId);
      if (!resolvedPlot) {
        try {
          const plotQuery: any = await supabase.from('plots').select('*').eq('project_name', targetProject);
          const plotsData = plotQuery?.data;
          if (Array.isArray(plotsData)) {
            resolvedPlot = plotsData.find((p: any) => p.id === selectedPlotId || p.plot_name === selectedPlotId);
          }
        } catch {
          // handled below if still missing
        }
      }
      if (!resolvedPlot?.id) {
        throw new Error('ไม่พบแปลงที่เลือกในโครงการ กรุณาเลือกแปลงใหม่');
      }
      const resolvedPlotId = resolvedPlot.id;

      const rentNum = parseFloat(monthlyRent) || 0;
      if (rentNum <= 0) throw new Error('กรุณาระบุค่าเช่าต่อเดือนให้ถูกต้อง');

      const bookingAmountNum = parseFloat(bookingAmount) || 0;
      const depositNum = parseFloat(customDeposit) || rentNum * 2;
      const savingsNum = selectedProgram === 'program_b' ? parseFloat(savingsPerMonth) || 5000 : 0;
      const priceNum = (selectedProgram === 'program_b' || selectedProgram === 'program_c') ? parseFloat(basePrice) || 0 : 0;
      const targetLeadId: string | null = effectiveLead?.leadId || effectiveLead?.id || null;
      const anyLead = effectiveLead as any;
      const expectedLeadRevision: string | null = anyLead?.deal_revision || null;
      const expectedLeadUpdatedAt: string | null = anyLead?.updated_at || null;
      const pendingContractId: string | null = anyLead?.pending_rental_contract_id || anyLead?.rental_contract_id || null;
      const expectedContractRevision: string | null = anyLead?.contract_deal_revision || null;

      // 🟡 1. โหมด "วางเงินจองเช่า" -> atomic RPC sales_tx_book_rental
      if (actionMode === 'booking') {
        const bookingNote = [
          notes.trim() || null,
          `[จองเช่า ${currentProgram.name}]: แปลง ${resolvedPlot.plot_name || resolvedPlotId}`,
          bookingAmountNum > 0 ? `เงินจอง: ${bookingAmountNum.toLocaleString()} บ.` : null,
          bookingDate ? `วันที่จอง: ${bookingDate}` : null,
          startDate ? `นัดทำสัญญา/เข้าอยู่: ${startDate}` : null,
          rentNum > 0 ? `ค่าเช่าประมาณ: ${rentNum.toLocaleString()} บ./ด.` : null,
        ].filter(Boolean).join(' | ');

        const payloadBase = {
          projectName: targetProject,
          plotId: resolvedPlotId,
          programType: selectedProgram,
          tenantName: tenantName.trim(),
          tenantPhone: tenantPhone.trim() || null,
          agentName: agentName.trim(),
          notes: bookingNote,
          leadId: targetLeadId,
          expectedLeadRevision,
          expectedLeadUpdatedAt,
          monthlyRent: rentNum,
          securityDeposit: depositNum,
          savingsPerMonth: savingsNum,
          basePrice: priceNum,
          bookingAmount: bookingAmountNum,
          bookingDate: bookingDate || null,
          startDate: startDate.trim() || null,
          durationMonths,
        };
        const txRequestId = getOrCreateSubmitRequestId(`booking:${JSON.stringify(payloadBase)}`);

        await bookRentalTx({
          requestId: txRequestId,
          actorRole: user?.role,
          ...payloadBase,
        });

        if (requestScope !== currentScope.current) return;
        pendingSubmitRef.current = null;
        onSaved?.();
        onClose();
        return;
      }

      // 🔑 2. โหมด "ทำสัญญาเช่าจริง" (จากจองเช่า หรือทำสัญญาตรง) -> atomic RPC sales_tx_sign_rental_contract
      const year4InterestNote = (selectedProgram === 'program_c' && durationMonths > 36)
        ? `[ปีที่ 4+: ค่างวดตกลง ${calcResults.year4BaseRent.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 })} บ. + ดอกเบี้ย 8% รวม ${calcResults.year4MonthlyRent.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} บ./ด.]`
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
        year4InterestNote,
      ].filter(Boolean).join(' ') || null;

      const resolvedStartDate = startDate.trim() || contractDate || new Date().toISOString().split('T')[0];

      const contractPayloadBase = {
        projectName: targetProject,
        plotId: resolvedPlotId,
        programType: selectedProgram,
        tenantName: tenantName.trim(),
        tenantPhone: tenantPhone.trim() || null,
        agentName: agentName.trim(),
        notes: contractNotes,
        leadId: targetLeadId,
        contractId: pendingContractId,
        expectedLeadRevision,
        expectedContractRevision,
        expectedLeadUpdatedAt,
        monthlyRent: rentNum,
        securityDeposit: depositNum,
        advanceRent: calcResults.advanceRent,
        savingsPerMonth: savingsNum,
        basePrice: priceNum,
        bookingAmount: bookingAmountNum,
        bookingDate: bookingDate || null,
        contractDate: contractDate || null,
        startDate: resolvedStartDate,
        durationMonths,
      };
      const txRequestId = getOrCreateSubmitRequestId(`contract:${JSON.stringify(contractPayloadBase)}`);

      await signRentalContractTx({
        requestId: txRequestId,
        actorRole: user?.role,
        ...contractPayloadBase,
      });

      if (requestScope !== currentScope.current) return;
      pendingSubmitRef.current = null;
      onSaved?.();
      onClose();
    } catch (error) {
      if (requestScope === currentScope.current) {
        const txErr = translateSalesTxError(error);
        if (txErr.code === 'SALES_TX_IDEMPOTENCY_CONFLICT') {
          pendingSubmitRef.current = null;
        }
        setErrorMsg(txErr.message);
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
        <div className={`text-white px-6 py-5 flex items-center justify-between shrink-0 transition-colors ${
          actionMode === 'booking'
            ? 'bg-gradient-to-r from-amber-700 via-amber-800 to-slate-900'
            : 'bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-2xl border ${
              actionMode === 'booking'
                ? 'bg-amber-500/20 text-amber-200 border-amber-400/30'
                : 'bg-blue-500/20 text-cyan-300 border-cyan-400/30'
            }`}>
              {actionMode === 'booking' ? <BookmarkCheck size={22} className="animate-pulse" /> : <Key size={22} className="animate-pulse" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-lg text-white">
                  {actionMode === 'booking' ? '🟡 วางเงินจองเช่า / ล็อกแปลง (Rental Booking)' : '🔑 ทำสัญญาเช่า / เช่าออม (Ailin Rental)'}
                </h3>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  actionMode === 'booking'
                    ? 'bg-amber-400/20 text-amber-200 border-amber-400/30'
                    : 'bg-cyan-400/20 text-cyan-200 border-cyan-400/30'
                }`}>
                  {targetProject}
                </span>
              </div>
              <p className="text-xs text-slate-200/90 mt-0.5">
                {actionMode === 'booking' 
                  ? 'บันทึกเงินจองล็อกแปลงบ้านสำหรับเช่า และกำหนดวันนัดทำสัญญาเช่าจริง' 
                  : 'บันทึกสัญญาเช่า 3 โปรแกรม ดึงลูกค้าจาก CRM และคำนวณหักเงินจองอัตโนมัติ'}
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

        {/* 🌟 Segmented Control: วางเงินจองเช่า vs ทำสัญญาเช่า 🌟 */}
        <div className="px-5 sm:px-6 pt-3.5 pb-2.5 bg-slate-50 border-b border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="grid grid-cols-2 p-1 bg-slate-200/80 rounded-2xl w-full sm:w-auto min-w-[340px] text-xs font-bold gap-1 shadow-inner">
            <button
              type="button"
              onClick={() => setActionMode('booking')}
              className={`py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                actionMode === 'booking'
                  ? 'bg-amber-500 text-white shadow-sm ring-1 ring-amber-600/20'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <BookmarkCheck size={14} />
              <span>🟡 วางเงินจองเช่า (ล็อกแปลง)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActionMode('contract');
                if (!startDate) {
                  setStartDate(new Date().toISOString().split('T')[0]);
                }
              }}
              className={`py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                actionMode === 'contract'
                  ? 'bg-blue-600 text-white shadow-sm ring-1 ring-blue-700/20'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <FileText size={14} />
              <span>🔑 ทำสัญญาเช่าจริง (เข้าอยู่)</span>
            </button>
          </div>
          <span className="text-[11px] text-slate-500 font-medium">
            {actionMode === 'booking' 
              ? '📌 วางมัดจำจองเพื่อล็อกแปลง และนัดวันทำสัญญา' 
              : '📝 ทำสัญญาพร้อมเข้าอยู่ และคำนวณหักเงินจองที่จ่ายไว้ให้อัตโนมัติ'}
          </span>
        </div>

        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-5 text-xs overflow-y-auto flex-1 dark-scrollbar">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center gap-2 font-medium">
              <AlertCircle size={16} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <fieldset disabled={submitting} className="contents">
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
                onClick={() => {
                  setSelectedProgram('program_c');
                  if (!contractFee || contractFee === '0' || contractFee === '10000') {
                    setContractFee('20000');
                  }
                }}
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
                    const isMyPlot = checkLeadPlotOwnership(effectiveLead, p, selectedPlotId || plotId);
                    const isRentalBooked = Boolean(
                      p.current_tenant_name &&
                      !p.lease_start_date &&
                      p.sale_status !== 'Rented' &&
                      (String(p.highlight_note || '').startsWith('จองเช่า:') || (isMyPlot && effectiveLead?.rental_status === 'PendingContract'))
                    );
                    const isBooked = p.sale_status === 'Booked' || p.sale_status === 'Reserved' || isRentalBooked || (p.has_customer && !p.current_tenant_name);
                    
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
                  <label htmlFor="rental-agent-select" className="text-slate-700 font-bold text-xs flex items-center gap-1">
                    <User size={13} className="text-slate-600" /> ผู้บันทึกสัญญา / เซลล์ผู้ดูแล <span className="text-rose-500">*</span>
                  </label>
                  {ownerSource === 'lead_owner' && (
                    <span className="text-[10px] font-bold text-blue-700 bg-blue-100/80 border border-blue-200 px-2 py-0.5 rounded-full flex items-center gap-1 animate-in fade-in">
                      <User size={10} className="text-blue-600" /> เซลล์เดิมที่ดูแลลูกค้า (ดึงให้อัตโนมัติ)
                    </span>
                  )}
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
                    id="rental-agent-select"
                    value={agentName}
                    onChange={e => {
                      setAgentName(e.target.value);
                      setOwnerSource('manual');
                    }}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-2xs"
                  >
                    {!salesOwners.some(o => o.displayName === agentName) && agentName && (
                      <option value={agentName}>{agentName} (เซลล์เดิมที่ดูแลลูกค้า)</option>
                    )}
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

            {actionMode === 'booking' ? (
              /* 🟡 โหมดวางเงินจองเช่า (Booking Mode): เรียบง่ายเฉพาะข้อมูลจำเป็นในการล็อกแปลง */
              <div className="space-y-3.5">
                <div className="p-3.5 sm:p-4 bg-white rounded-2xl border border-amber-200 shadow-2xs space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-amber-100 pb-2">
                    <span className="font-bold text-amber-950 text-xs flex items-center gap-1.5">
                      <BookmarkCheck size={14} className="text-amber-600" /> ข้อมูลการวางเงินจองเช่า & กำหนดวันนัดทำสัญญา
                    </span>
                    <span className="text-[11px] text-amber-800 font-medium">
                      บันทึกยอดเงินจองเพื่อล็อกแปลง (ยังไม่ต้องใส่วันที่ทำสัญญาจริงหรือเงินประกัน)
                    </span>
                  </div>

                  {/* 📋 กล่องแสดงข้อมูลเดิมที่บันทึกไว้ในระบบ (กรณีเคยบันทึกจองไว้แล้ว) */}
                  {hasPriorBooking ? (
                    <div className="bg-amber-50/90 border border-amber-300 rounded-2xl p-3.5 space-y-2.5 text-xs shadow-2xs">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 border-b border-amber-200/80 pb-2">
                        <div className="flex items-center gap-1.5 font-bold text-amber-950">
                          <BookmarkCheck size={16} className="text-amber-600" />
                          <span>ข้อมูลการจองเดิมในระบบ (บันทึกไว้แล้ว)</span>
                        </div>
                        <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100/90 border border-emerald-300 px-2.5 py-0.5 rounded-full flex items-center gap-1 self-start sm:self-auto">
                          <Sparkles size={11} className="text-emerald-600" /> บันทึกซ้ำจะอัปเดตทับข้อมูลนี้ (ไม่นับเป็นจองซ้ำ)
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                        <div className="bg-white/90 p-2 rounded-xl border border-amber-200/70 shadow-2xs">
                          <span className="text-slate-500 block text-[10px] font-medium">ยอดเงินจองเดิม</span>
                          <span className="font-bold text-amber-900 text-xs">
                            {priorBookingAmount !== null ? `${priorBookingAmount.toLocaleString()} บาท` : <span className="text-slate-400 font-normal">ยังไม่ได้ระบุ</span>}
                          </span>
                        </div>
                        <div className="bg-white/90 p-2 rounded-xl border border-amber-200/70 shadow-2xs">
                          <span className="text-slate-500 block text-[10px] font-medium">วันที่วางเงินจองเดิม</span>
                          <span className="font-bold text-slate-800">
                            {priorBookingDate || <span className="text-slate-400 font-normal">ยังไม่ได้ระบุ</span>}
                          </span>
                        </div>
                        <div className="bg-white/90 p-2 rounded-xl border border-amber-200/70 shadow-2xs">
                          <span className="text-slate-500 block text-[10px] font-medium">ค่าเช่าต่อเดือนเดิม</span>
                          <span className="font-bold text-blue-900 text-xs">
                            {priorMonthlyRent !== null ? `${priorMonthlyRent.toLocaleString()} บ./ด.` : <span className="text-slate-400 font-normal">ยังไม่ได้ระบุ</span>}
                          </span>
                        </div>
                        <div className="bg-white/90 p-2 rounded-xl border border-amber-200/70 shadow-2xs">
                          <span className="text-slate-500 block text-[10px] font-medium">วันนัดทำสัญญา/เข้าอยู่เดิม</span>
                          <span className="font-bold text-slate-800">
                            {priorStartDate || <span className="text-slate-400 font-normal">ยังไม่ได้ระบุ</span>}
                          </span>
                        </div>
                      </div>

                      {(priorPlotName || priorProgram || priorAgent) && (
                        <div className="pt-1 flex flex-wrap items-center gap-2 text-[10px] text-amber-900 font-medium">
                          {priorPlotName && (
                            <span className="bg-white/80 border border-amber-200/80 px-2 py-0.5 rounded-lg">
                              <b>แปลงที่ล็อก:</b> {priorPlotName}
                            </span>
                          )}
                          {priorProgram && (
                            <span className="bg-white/80 border border-amber-200/80 px-2 py-0.5 rounded-lg">
                              <b>โปรแกรม:</b> {priorProgram}
                            </span>
                          )}
                          {priorAgent && (
                            <span className="bg-white/80 border border-amber-200/80 px-2 py-0.5 rounded-lg">
                              <b>เซลล์เดิม:</b> {priorAgent}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-blue-50/70 border border-blue-200/80 rounded-xl px-3 py-2 flex items-center justify-between text-xs text-blue-900">
                      <span className="flex items-center gap-1.5 font-bold text-[11px] text-blue-950">
                        <Sparkles size={14} className="text-blue-600" /> การวางเงินจองใหม่ครั้งแรก
                      </span>
                      <span className="text-[10px] text-blue-700 font-medium">ยังไม่มีข้อมูลการจองเดิมในระบบ</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                    {/* 1. วันที่วางเงินจอง */}
                    <div>
                      <label htmlFor="rental-booking-date" className="block text-slate-700 font-bold mb-1 text-[11px]">
                        วันที่วางเงินจอง (Booking Date) <span className="text-rose-500">*</span>
                      </label>
                      <input
                        id="rental-booking-date"
                        type="date"
                        required
                        value={bookingDate}
                        onChange={e => setBookingDate(e.target.value)}
                        className="w-full bg-slate-50/80 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:bg-white focus:ring-2 focus:ring-amber-500 focus:outline-none"
                      />
                      <span className="text-[10px] text-slate-400 block mt-0.5">วันชำระเงินจองล็อกแปลง</span>
                    </div>

                    {/* 2. ยอดเงินจองเช่า */}
                    <div>
                      <label htmlFor="rental-booking-amount" className="block text-slate-700 font-bold mb-1 text-[11px]">
                        ยอดเงินจองเช่า / ล็อกแปลง (บาท) <span className="text-rose-500">*</span>
                      </label>
                      <div className="relative">
                        <input
                          id="rental-booking-amount"
                          type="number"
                          required
                          min="0"
                          step="any"
                          value={bookingAmount}
                          onChange={e => setBookingAmount(e.target.value)}
                          placeholder="เช่น 5,000 หรือ 10,000"
                          className="w-full bg-slate-50/80 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-amber-500 focus:outline-none pr-8"
                        />
                        <span className="absolute right-3 top-2.5 text-[11px] text-slate-400 font-bold pointer-events-none">บาท</span>
                      </div>
                      <span className="text-[10px] text-slate-400 block mt-0.5">นำไปหักวันทำสัญญาเช่าจริง</span>
                    </div>

                    {/* 3. วันที่นัดทำสัญญาเช่าจริง / คาดว่าจะเข้าอยู่ (ถ้ามี/ไม่บังคับ) */}
                    <div>
                      <label htmlFor="rental-start-date" className="block text-slate-700 font-bold mb-1 text-[11px]">
                        วันที่นัดทำสัญญา / คาดว่าจะเข้าอยู่ <span className="text-[10px] text-slate-400 font-normal">(ถ้ามี)</span>
                      </label>
                      <input
                        id="rental-start-date"
                        type="date"
                        value={startDate}
                        onChange={e => setStartDate(e.target.value)}
                        className="w-full bg-slate-50/80 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:bg-white focus:ring-2 focus:ring-amber-500 focus:outline-none"
                      />
                      <span className="text-[10px] text-slate-400 block mt-0.5">ระบุหรือไม่ระบุก็ได้ นัดหมายภายหลังได้</span>
                    </div>

                    {/* 4. ค่าเช่าต่อเดือนโดยประมาณ */}
                    <div>
                      <label htmlFor="rental-monthly-rent" className="block text-slate-700 font-bold mb-1 text-[11px]">
                        ค่าเช่าต่อเดือนโดยประมาณ (บาท) <span className="text-rose-500">*</span>
                      </label>
                      <div className="relative">
                        <input
                          id="rental-monthly-rent"
                          type="number"
                          required
                          min="0"
                          step="any"
                          value={monthlyRent}
                          onChange={e => setMonthlyRent(e.target.value)}
                          placeholder="เช่น 15,000"
                          className="w-full bg-slate-50/80 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-amber-500 focus:outline-none pr-14"
                        />
                        <span className="absolute right-3 top-2.5 text-[11px] text-slate-400 font-bold pointer-events-none">บ./ด.</span>
                      </div>
                      <span className="text-[10px] text-slate-400 block mt-0.5">ราคาประเมินค่าเช่าตามตกลง</span>
                    </div>
                  </div>

                  {/* ราคาบ้านที่ตกลง (กรณีเลือกแบบ B หรือ C เพื่อบันทึกราคาล็อกไว้) */}
                  {(selectedProgram === 'program_b' || selectedProgram === 'program_c') && (
                    <div className="pt-2 border-t border-amber-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div className="space-y-0.5">
                        <label htmlFor="rental-booking-base-price" className="text-amber-950 font-bold text-xs flex items-center gap-1.5">
                          <Home size={14} className="text-amber-600" />
                          <span>ราคาบ้านที่ตกลงขายสำหรับโปรแกรม {selectedProgram === 'program_b' ? 'เช่าซื้อ (B)' : 'เช่าออม (C)'} (บาท):</span>
                        </label>
                        <span className="text-[11px] text-amber-800">
                          ราคาบ้านที่ตกลงจะนำไปเป็นฐานในการคำนวณเงินสะสมหรือส่วนลดเมื่อทำสัญญาจริง
                        </span>
                      </div>
                      <div className="relative min-w-[200px]">
                        <input
                          id="rental-booking-base-price"
                          type="number"
                          min="0"
                          step="any"
                          value={basePrice}
                          onChange={e => setBasePrice(e.target.value)}
                          placeholder="ระบุราคาบ้าน"
                          className="w-full bg-amber-50/50 border border-amber-300 rounded-xl px-3 py-1.5 text-xs font-black text-amber-950 focus:bg-white focus:ring-2 focus:ring-amber-500 focus:outline-none pr-10"
                        />
                        <span className="absolute right-3 top-1.5 text-xs text-amber-700 font-bold pointer-events-none">บาท</span>
                      </div>
                    </div>
                  )}

                  {/* คำแนะนำขั้นตอนถัดไปสำหรับการจอง */}
                  <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl px-3.5 py-2.5 flex items-start gap-2 text-xs text-amber-900">
                    <Info size={15} className="text-amber-600 shrink-0 mt-0.5" />
                    <div className="space-y-0.5 text-[11px]">
                      <span className="font-bold text-amber-950">คำแนะนำการทำงาน:</span>
                      <p className="text-amber-800">
                        ขั้นตอนวางเงินจองนี้จะไม่เรียกเก็บเงินประกันบ้านหรือค่าเช่าล่วงหน้า โดยระบบจะเปลี่ยนสถานะแปลงเป็น <b>&quot;ติดจอง (Booked)&quot;</b> เพื่อล็อกแปลงให้ลูกค้าทันที เมื่อถึงวันที่ลูกค้าสะดวกทำสัญญาจริง เซลล์สามารถกดปุ่ม <b>&quot;ทำสัญญาเช่า&quot;</b> จากกระดานคัมบัง เพื่อกรอกรายละเอียดสัญญาและนำเงินจองนี้ไปหักลบยอดชำระแรกเข้าให้อัตโนมัติ
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* 🔑 โหมดทำสัญญาเช่าจริง (Contract Mode): ครบทุกรายละเอียดสัญญา */
              <div className="space-y-3.5">
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
                          step="any"
                          value={bookingAmount}
                          onChange={e => setBookingAmount(e.target.value)}
                          placeholder="เช่น 10,000"
                          className="w-full bg-slate-50/80 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none pr-8"
                        />
                        <span className="absolute right-3 top-2.5 text-[11px] text-slate-400 font-bold pointer-events-none">บาท</span>
                      </div>
                      <span className="text-[10px] text-slate-400 block mt-0.5">นำไปหักยอดชำระวันสัญญา</span>
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
                          step="any"
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
                          step="any"
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
                          step="any"
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
                          step="any"
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
                          step="any"
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
                          step="any"
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
                                    step="any"
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
                                    ({calcResults.year4BaseRent.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 })} + ดอกเบี้ย {calcResults.year4InterestAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} บ.)
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="font-black text-amber-900 text-sm">
                                    {calcResults.year4MonthlyRent.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                                  </div>
                                  <div className="text-[9px] text-amber-700">บาท/เดือน</div>
                                </div>
                              </div>
                            </div>
                          </div>

                          {durationMonths > 36 && (
                            <div className="p-2 bg-blue-50 border border-blue-200 text-blue-900 rounded-lg text-[11px] font-semibold flex items-center gap-1.5">
                              <span>📌 สัญญานี้มีระยะเวลา {durationMonths} เดือน: ตั้งแต่งวดเดือนที่ 37 เป็นต้นไป ค่าผ่อนจะปรับเป็น <b>{calcResults.year4MonthlyRent.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} บาท/เดือน</b> (ค่างวดตกลง {calcResults.year4BaseRent.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 })} บ. + ดอกเบี้ย 8%) ตามเงื่อนไข</span>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* Total Initial Payment Summary */}
            <div className={`p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              actionMode === 'booking'
                ? 'bg-amber-50/80 border-amber-200'
                : 'bg-indigo-50/80 border-indigo-200'
            }`}>
              <div>
                <span className={`font-bold text-xs flex items-center gap-1.5 ${
                  actionMode === 'booking' ? 'text-amber-900' : 'text-indigo-900'
                }`}>
                  <Receipt size={14} className={actionMode === 'booking' ? 'text-amber-600' : 'text-indigo-600'} />
                  {actionMode === 'booking' ? 'ยอดเงินจองเช่าที่ต้องชำระ (เพื่อล็อกแปลง):' : 'ยอดรวมชำระวันทำสัญญา:'}
                </span>
                {actionMode === 'booking' ? (
                  <p className="text-[11px] text-amber-800 font-semibold mt-1">
                    เงินจองเช่าจะนำไปหักออกจากยอดเงินประกัน/ค่าใช้จ่ายแรกเข้าเมื่อถึงวันทำสัญญาจริง
                  </p>
                ) : (
                  <div>
                    <p className="text-[11px] text-indigo-700 font-semibold mt-0.5">
                      {[
                        calcResults.securityDeposit > 0 ? `ประกัน ${depositMonths} ด. (${calcResults.securityDeposit.toLocaleString()} บ.)` : null,
                        hasAdvanceRent ? `ล่วงหน้า ${advanceRentMonths} ด. (${calcResults.advanceRent.toLocaleString()} บ.)` : null,
                        (selectedProgram === 'program_c' && calcResults.appliedContractFee > 0) ? `ค่าสัญญา (${calcResults.appliedContractFee.toLocaleString()} บ.)` : null
                      ].filter(Boolean).join(' + ') || '0 บาท'}
                    </p>
                    {parseFloat(bookingAmount) > 0 && (
                      <p className="text-[11px] text-emerald-700 font-bold mt-1 flex items-center gap-1">
                        <span>🏷️ หักเงินจองเช่าที่ชำระแล้ว:</span>
                        <b>-{(parseFloat(bookingAmount) || 0).toLocaleString()} บาท</b>
                      </p>
                    )}
                    <p className="text-[10px] text-indigo-500 mt-0.5">เงินประกันจะได้รับคืนเมื่อสิ้นสุดสัญญาตามเงื่อนไข</p>
                  </div>
                )}
              </div>
              <div className="text-right shrink-0">
                {actionMode === 'booking' ? (
                  <div className="text-base font-black text-amber-800 bg-white px-3.5 py-1.5 rounded-xl border border-amber-300 shadow-sm self-end sm:self-auto">
                    {(parseFloat(bookingAmount) || 0).toLocaleString()} บาท
                  </div>
                ) : (
                  <div className="bg-white px-3.5 py-1.5 rounded-xl border border-indigo-200 shadow-sm self-end sm:self-auto">
                    {parseFloat(bookingAmount) > 0 ? (
                      <div>
                        <div className="text-[10px] text-slate-400 font-medium line-through">
                          ฿{calcResults.totalInitialPayment.toLocaleString()}
                        </div>
                        <div className="text-sm font-black text-emerald-700">
                          ฿{Math.max(0, calcResults.totalInitialPayment - (parseFloat(bookingAmount) || 0)).toLocaleString()} บ.
                        </div>
                        <div className="text-[9px] text-emerald-600 font-bold">ยอดสุทธิที่ต้องชำระวันสัญญา</div>
                      </div>
                    ) : (
                      <div className="text-sm font-black text-indigo-700">
                        {calcResults.totalInitialPayment.toLocaleString()} บาท
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-slate-700 font-bold mb-1">
              {actionMode === 'booking' ? 'หมายเหตุการจองเช่า / เงื่อนไขพิเศษ' : 'หมายเหตุ / เงื่อนไขเพิ่มเติมในสัญญา'}
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={actionMode === 'booking' ? 'เช่น นัดทำสัญญาเช่าจริงวันที่ 1 พ.ย. 2026, วางมัดจำจองผ่านบัญชีบริษัท...' : 'เช่น มีสัตว์เลี้ยง 1 ตัว, แถมเฟอร์นิเจอร์ห้องนอน, กำหนดชำระค่าเช่าทุกวันที่ 5 ของเดือน...'}
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
            {actionMode === 'booking' ? (
              <button
                type="submit"
                disabled={!canWriteRental || submitting || loadingPlots}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-600 via-amber-500 to-amber-700 hover:from-amber-700 hover:to-amber-800 text-white font-bold shadow-md shadow-amber-500/20 cursor-pointer flex items-center gap-2 transition-all disabled:opacity-50"
              >
                <BookmarkCheck size={16} />
                <span>{submitting ? 'กำลังบันทึกการจองเช่า...' : 'ยืนยันบันทึกการจองเช่า (ล็อกแปลง)'}</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canWriteRental || submitting || loadingPlots}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-700 via-indigo-700 to-slate-900 hover:from-blue-800 hover:to-slate-950 text-white font-bold shadow-md shadow-indigo-700/20 cursor-pointer flex items-center gap-2 transition-all disabled:opacity-50"
              >
                <Key size={15} />
                <span>{submitting ? 'กำลังบันทึกสัญญา...' : 'ยืนยันบันทึกสัญญาเช่า'}</span>
              </button>
            )}
          </div>
        </form>
      </div>
    </SalesOverlay>
  );
}

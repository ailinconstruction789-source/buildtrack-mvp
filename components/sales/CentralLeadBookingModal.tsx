'use client';

import React, { useState, useEffect } from 'react';
import { 
  X, Tag, Building2, Home, User, Phone, 
  Calendar, CreditCard, DollarSign, FileText, 
  CheckCircle2, AlertCircle, Loader2, Sparkles, Receipt,
  Pickaxe, CheckCircle, Maximize2, ArrowRight, Plus,
  Gift, Trash2, CheckSquare, Square, Percent, Sliders
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { loadAvailablePlots } from '@/lib/sales/plotAvailabilityClient';
import type { InterestedPlot } from '@/lib/sales/plotAvailability';
import LeadPicker from './LeadPicker';

// 🏠 Master Freebies Catalog Grouped by Categories
const MASTER_FREEBIES_CATALOG = [
  {
    category: 'เครื่องใช้ไฟฟ้า',
    icon: '⚡',
    items: [
      { name: 'แอร์ 18,000 BTU (ห้องโถง)', defaultQty: 1 },
      { name: 'แอร์ 12,000 BTU (ห้องนอน)', defaultQty: 2 },
      { name: 'Smart TV ขนาด 55 นิ้ว', defaultQty: 1 },
      { name: 'ตู้เย็น 2 ประตู (14.1 คิว)', defaultQty: 1 },
      { name: 'เครื่องทำน้ำอุ่น', defaultQty: 2 },
    ]
  },
  {
    category: 'เฟอร์นิเจอร์ & ห้องโถง',
    icon: '🛋️',
    items: [
      { name: 'ชุดโซฟาห้องโถง + โต๊ะกลาง', defaultQty: 1 },
      { name: 'ไซด์บอร์ดวาง TV', defaultQty: 1 },
      { name: 'ชุดโต๊ะอาหาร 4-6 ที่นั่ง', defaultQty: 1 },
      { name: 'ผ้าม่านกัน UV ทั้งหลัง', defaultQty: 1 },
    ]
  },
  {
    category: 'ชุดห้องนอน',
    icon: '🛏️',
    items: [
      { name: 'เตียง 6 ฟุต + ฟูกที่นอน (ห้องมาสเตอร์)', defaultQty: 1 },
      { name: 'ตู้เสื้อผ้า (ห้องมาสเตอร์)', defaultQty: 1 },
      { name: 'โต๊ะเครื่องแป้ง (ห้องมาสเตอร์)', defaultQty: 1 },
      { name: 'เตียง 5 ฟุต + ฟูกที่นอน (ห้องนอน 2)', defaultQty: 1 },
    ]
  },
  {
    category: 'งานระบบ & ภายนอกบ้าน',
    icon: '🌳',
    items: [
      { name: 'ปั๊มน้ำอัตโนมัติ + ถังเก็บน้ำ', defaultQty: 1 },
      { name: 'จัดสวนปูหญ้าสนามรอบบ้าน', defaultQty: 1 },
      { name: 'เคาน์เตอร์ครัว + ซิงค์ล้างจาน', defaultQty: 1 },
    ]
  },
  {
    category: 'โปรโมชั่นค่าใช้จ่ายวันโอน',
    icon: '🎁',
    items: [
      { name: 'ฟรี ค่าธรรมเนียมการโอนกรรมสิทธิ์', defaultQty: 1 },
      { name: 'ฟรี ค่าติดตั้งมิเตอร์น้ำ - มิเตอร์ไฟ', defaultQty: 1 },
      { name: 'ฟรี ค่าส่วนกลางล่วงหน้า 1 ปี', defaultQty: 1 },
    ]
  }
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  customer?: {
    id?: string;
    name?: string;
    customer_name?: string;
    phone?: string | null;
    channel?: string | null;
    notes?: string | null;
    status?: string | null;
    ownerUserId?: string;
    owner_user_id?: string;
    salesOwner?: string | null;
    sales_owner?: string | null;
    agent_name?: string | null;
    project_name?: string | null;
    interested_plot_name?: string | null;
    interested_plot_id?: string | null;
  } | null;
  initialInterest?: {
    id?: string;
    projectName?: string;
    plotId?: string | null;
    ownerUserId?: string;
  } | null;
  projects: string[];
  salesOwners: { userId: string; displayName: string }[];
  currentUser?: { userId?: string; displayName?: string; username?: string; name?: string } | null;
  onSaved?: (notice: string) => void;
  onSwitchToRental?: () => void;
}

export default function CentralLeadBookingModal({
  isOpen,
  onClose,
  customer: initialCustomer,
  initialInterest,
  projects = [],
  salesOwners = [],
  currentUser,
  onSaved,
  onSwitchToRental
}: Props) {
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(initialCustomer || null);
  const [isNewCustomerMode, setIsNewCustomerMode] = useState(false);
  const [walkInName, setWalkInName] = useState('');
  const [walkInPhone, setWalkInPhone] = useState('');

  const [projectName, setProjectName] = useState('');
  const [plotId, setPlotId] = useState('');
  const [availablePlots, setAvailablePlots] = useState<InterestedPlot[]>([]);
  const [loadingPlots, setLoadingPlots] = useState(false);

  // Construction preview state
  const [plotInfo, setPlotInfo] = useState<any>(null);
  const [loadingPlotInfo, setLoadingPlotInfo] = useState(false);
  const [fullImageUrl, setFullImageUrl] = useState<string | null>(null);

  // 🎁 Freebies & Promotion State (รองรับ: รับของแถม vs ไม่รับแถมเปลี่ยนเป็นส่วนลดเงินสดทั้งหมด)
  const [promoMode, setPromoMode] = useState<'freebies' | 'discount'>('freebies');
  const [freebieDiscount, setFreebieDiscount] = useState('0');
  const [selectedFreebies, setSelectedFreebies] = useState<Array<{ category: string; item_name: string; quantity: number }>>([]);
  const [showAddCustomFreebie, setShowAddCustomFreebie] = useState(false);
  const [customFreebieName, setCustomFreebieName] = useState('');
  const [customFreebieCategory, setCustomFreebieCategory] = useState('เครื่องใช้ไฟฟ้า');
  const [customFreebieQty, setCustomFreebieQty] = useState(1);

  const [listPrice, setListPrice] = useState('');
  const [discount, setDiscount] = useState('0');
  const [deposit, setDeposit] = useState('10000');
  const [paymentMethod, setPaymentMethod] = useState<'mortgage' | 'cash'>('mortgage');
  const [contractDueDate, setContractDueDate] = useState('');
  const [agentName, setAgentName] = useState('');
  const [ownerSource, setOwnerSource] = useState<'current_user' | 'manual'>('current_user');
  const [notes, setNotes] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Handle lead selection
  const handleLeadSelect = (chosenLead: any | null) => {
    setSelectedCustomer(chosenLead);
    if (chosenLead) {
      if (chosenLead.project_name) setProjectName(chosenLead.project_name);
      if (chosenLead.interested_plot_id || chosenLead.interested_plot_name) {
        setPlotId(chosenLead.interested_plot_name || chosenLead.interested_plot_id);
      }
      // Default closer is the logged in user (ID ที่กำลังใช้งานระบบอยู่)
      const defaultUser = currentUser?.displayName || currentUser?.username || currentUser?.name || salesOwners[0]?.displayName || 'ทีมขาย';
      setAgentName(defaultUser);
      setOwnerSource('current_user');
      setIsNewCustomerMode(false);
    }
  };

  // Default contract date in 7 days & sync customer
  useEffect(() => {
    if (isOpen) {
      setErrorMsg('');
      const cust = initialCustomer || null;
      setSelectedCustomer(cust);
      const proj = initialInterest?.projectName || cust?.project_name || (projects.length > 0 ? projects[0] : '');
      setProjectName(proj);
      setPlotId(initialInterest?.plotId || cust?.interested_plot_name || cust?.interested_plot_id || '');
      setListPrice('');
      setDiscount('0');
      setDeposit('10000');
      setPaymentMethod('mortgage');
      setNotes('');
      setPlotInfo(null);

      const d = new Date();
      d.setDate(d.getDate() + 7);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      setContractDueDate(`${yyyy}-${mm}-${dd}`);

      // Default closer is always the logged in user (ID ปัจจุบันที่กำลังบันทึก)
      const defaultUser = currentUser?.displayName || currentUser?.username || currentUser?.name || salesOwners[0]?.displayName || 'ทีมขาย';
      setAgentName(defaultUser);
      setOwnerSource('current_user');
    }
  }, [isOpen, initialCustomer, initialInterest, projects, salesOwners, currentUser]);

  // Load available plots when project changes
  useEffect(() => {
    if (!projectName) {
      setAvailablePlots([]);
      setPlotInfo(null);
      return;
    }
    let cancelled = false;
    setLoadingPlots(true);
    loadAvailablePlots(projectName)
      .then(plots => {
        if (!cancelled) {
          setAvailablePlots(plots);
          setLoadingPlots(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAvailablePlots([]);
          setLoadingPlots(false);
        }
      });
    return () => { cancelled = true; };
  }, [projectName]);

  // Load Construction Info & Plot Pricing when plotId or projectName changes
  useEffect(() => {
    if (!plotId || !projectName) {
      setPlotInfo(null);
      return;
    }

    let cancelled = false;
    setLoadingPlotInfo(true);

    const fetchPlotDetails = async () => {
      try {
        // Query plot details
        const { data: plotData } = await supabase
          .from('plots')
          .select('*, house_types(type_name)')
          .eq('project_name', projectName)
          .or(`id.eq.${plotId},plot_name.eq.${plotId},id.eq.${projectName}-${plotId}`)
          .maybeSingle();

        if (cancelled) return;

        if (plotData) {
          // Fetch progress from vw_plot_progress
          const { data: progressData } = await supabase
            .from('vw_plot_progress')
            .select('overall_progress')
            .eq('plot_id', plotData.id)
            .maybeSingle();

          // Fetch tasks & schedules
          const [tasksRes, schedRes, assignsRes] = await Promise.all([
            supabase.from('task_templates').select('id, task_name').eq('house_type_id', plotData.house_type_id),
            supabase.from('schedules').select('task_template_id, planned_start, planned_end').eq('plot_id', plotData.id),
            supabase.from('plot_task_assignments').select('task_template_id, current_progress').eq('plot_id', plotData.id)
          ]);

          let progress = progressData?.overall_progress ? Number(progressData.overall_progress) : 0;
          let statusInfo = null;
          let activeTask: any = null;

          if (tasksRes.data && tasksRes.data.length > 0) {
            let totalActual = 0;
            let totalPlanned = 0;
            const today = plotData.sale_status === 'ready_for_sale' && plotData.paused_for_sale_at ? new Date(plotData.paused_for_sale_at).getTime() : Date.now();
            
            const schedMap = new Map(schedRes.data?.map((s: any) => [s.task_template_id, s]) || []);
            const assignMap = new Map(assignsRes.data?.map((a: any) => [a.task_template_id, a.current_progress]) || []);

            tasksRes.data.forEach((task: any) => {
              const actual = assignMap.get(task.id) || 0;
              totalActual += actual;
              
              const plan = schedMap.get(task.id) as any;
              let plannedProg = 0;
              if (plan && plan.planned_start && plan.planned_end) {
                const pStart = new Date(plan.planned_start).getTime(); 
                const pEnd = new Date(plan.planned_end).getTime();
                if (today >= pEnd) plannedProg = 100; 
                else if (today <= pStart) plannedProg = 0; 
                else plannedProg = Math.round(((today - pStart) / (pEnd - pStart)) * 100);
              }
              totalPlanned += plannedProg;
              
              if (actual > 0 && actual < 100 && !activeTask) {
                activeTask = `${task.task_name} (${actual}%)`;
              }
            });

            const actualAvg = Math.round(totalActual / tasksRes.data.length); 
            const plannedAvg = Math.round(totalPlanned / tasksRes.data.length);

            if (plotData.sale_status === 'ready_for_sale') statusInfo = { status: 'ready_for_sale', label: 'พร้อมขาย/รอโอน', color: 'text-amber-600', bg: 'bg-amber-100' };
            else if (actualAvg === 0 && plannedAvg === 0) statusInfo = { status: 'none', label: 'รอดำเนินการ', color: 'text-slate-500', bg: 'bg-slate-100' };
            else if (actualAvg >= 100 && plannedAvg >= 100) statusInfo = { status: 'completed', label: 'ก่อสร้างเสร็จสิ้น', color: 'text-emerald-700', bg: 'bg-emerald-100' };
            else if (actualAvg < plannedAvg) statusInfo = { status: 'delayed', label: 'ล่าช้ากว่าแผน', color: 'text-rose-700', bg: 'bg-rose-100' };
            else if (actualAvg > plannedAvg + 10) statusInfo = { status: 'ahead', label: 'เร็วกว่าแผน', color: 'text-indigo-700', bg: 'bg-indigo-100' };
            else statusInfo = { status: 'on-track', label: 'ตามแผน', color: 'text-blue-700', bg: 'bg-blue-100' };
          }

          const combinedPlotInfo = {
            ...plotData,
            progress,
            statusInfo,
            activeTask
          };

          setPlotInfo(combinedPlotInfo);

          // Auto-fill list price from plot's selling_price if available
          if (plotData.selling_price && Number(plotData.selling_price) > 0) {
            setListPrice(Number(plotData.selling_price).toLocaleString('en-US'));
          }

          // Fetch existing promotions from plot_promotions table
          try {
            const { data: promosData } = await supabase
              .from('plot_promotions')
              .select('id, category, item_name, quantity, status')
              .eq('plot_id', plotData.id);

            if (promosData && promosData.length > 0) {
              setSelectedFreebies(promosData.map((p: any) => ({
                category: p.category || 'ทั่วไป',
                item_name: p.item_name,
                quantity: p.quantity || 1
              })));
              setPromoMode('freebies');
            } else {
              // Default to full master catalog items so sales can choose/customize immediately
              const defaultCatalogItems = MASTER_FREEBIES_CATALOG.flatMap(c => 
                c.items.map(i => ({
                  category: c.category,
                  item_name: i.name,
                  quantity: i.defaultQty
                }))
              );
              setSelectedFreebies(defaultCatalogItems);
              setPromoMode('freebies');
            }
          } catch (promoErr) {
            console.warn('Error loading plot promotions:', promoErr);
          }
        } else {
          setPlotInfo(null);
        }
      } catch (err) {
        console.error('Error fetching plot construction details:', err);
      } finally {
        if (!cancelled) setLoadingPlotInfo(false);
      }
    };

    fetchPlotDetails();

    return () => { cancelled = true; };
  }, [plotId, projectName]);

  // Freebies Helper Functions
  const toggleFreebie = (category: string, name: string, defaultQty: number = 1) => {
    setSelectedFreebies(prev => {
      const exists = prev.some(f => f.item_name === name);
      if (exists) {
        return prev.filter(f => f.item_name !== name);
      } else {
        return [...prev, { category, item_name: name, quantity: defaultQty }];
      }
    });
  };

  const updateFreebieQty = (name: string, delta: number) => {
    setSelectedFreebies(prev => prev.map(f => {
      if (f.item_name === name) {
        return { ...f, quantity: Math.max(1, f.quantity + delta) };
      }
      return f;
    }));
  };

  const removeFreebie = (name: string) => {
    setSelectedFreebies(prev => prev.filter(f => f.item_name !== name));
  };

  const selectAllMasterFreebies = () => {
    const all = MASTER_FREEBIES_CATALOG.flatMap(c => 
      c.items.map(i => ({
        category: c.category,
        item_name: i.name,
        quantity: i.defaultQty
      }))
    );
    setSelectedFreebies(all);
  };

  const clearAllFreebies = () => {
    setSelectedFreebies([]);
  };

  const handleAddCustomFreebie = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customFreebieName.trim()) return;
    setSelectedFreebies(prev => [
      ...prev.filter(f => f.item_name !== customFreebieName.trim()),
      {
        category: customFreebieCategory,
        item_name: customFreebieName.trim(),
        quantity: Math.max(1, customFreebieQty)
      }
    ]);
    setCustomFreebieName('');
    setCustomFreebieQty(1);
    setShowAddCustomFreebie(false);
  };

  if (!isOpen) return null;

  // Numeric helpers
  const parseNum = (val: string) => {
    const cleaned = val.replace(/,/g, '').trim();
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  };

  const rawListPrice = parseNum(listPrice);
  const rawDiscount = parseNum(discount);
  const rawFreebieDiscount = promoMode === 'discount' ? parseNum(freebieDiscount) : 0;
  const totalDiscount = rawDiscount + rawFreebieDiscount;
  const netSellingPrice = Math.max(0, rawListPrice - totalDiscount);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName) {
      setErrorMsg('กรุณาเลือกโครงการที่ต้องการจอง');
      return;
    }
    if (!plotId) {
      setErrorMsg('กรุณาเลือกแปลงที่ต้องการจอง');
      return;
    }

    const effectiveCustomer = selectedCustomer || initialCustomer;
    const effectiveName = isNewCustomerMode ? walkInName.trim() : (effectiveCustomer?.name || effectiveCustomer?.customer_name || '');
    const effectivePhone = isNewCustomerMode ? walkInPhone.trim() : (effectiveCustomer?.phone || '');

    if (!effectiveName) {
      setErrorMsg('กรุณาเลือกรายชื่อลูกค้าจาก Lead หรือระบุชื่อลูกค้า');
      return;
    }

    const depositNum = parseNum(deposit);
    if (depositNum < 0) {
      setErrorMsg('กรุณาระบุจำนวนเงินจองให้ถูกต้อง');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const now = new Date();
      const timeBangkokStr = now.toLocaleDateString('th-TH', { 
        day: '2-digit', month: 'short', year: 'numeric', 
        hour: '2-digit', minute: '2-digit' 
      });

      // 1. Prepare timestamped summary notes
      const freebieSummaryText = promoMode === 'freebies'
        ? (selectedFreebies.length > 0
            ? `• ของแถมที่ได้รับ (${selectedFreebies.length} รายการ):\n` + selectedFreebies.map(f => `  - [${f.category}] ${f.item_name} (x${f.quantity})`).join('\n')
            : '• โปรโมชั่นของแถม: ไม่ได้รับของแถม')
        : `• โปรโมชั่นของแถม: ไม่รับของแถมทุกรายการ — เปลี่ยนเป็นส่วนลดเงินสด ฿${rawFreebieDiscount.toLocaleString('th-TH')} บาท`;

      const bookingSummary = `[${timeBangkokStr} 🏷️ บันทึกการจอง โดย ${agentName || 'ทีมขาย'}]\n` +
        `• โครงการ: ${projectName} (แปลง ${plotId})\n` +
        (rawListPrice > 0 ? `• ราคาก่อนส่วนลด: ฿${rawListPrice.toLocaleString('th-TH')} บาท\n` : '') +
        (rawDiscount > 0 ? `• ส่วนลดโปรโมชั่น: ฿${rawDiscount.toLocaleString('th-TH')} บาท\n` : '') +
        (promoMode === 'discount' && rawFreebieDiscount > 0 ? `• ส่วนลดจากการไม่รับของแถม: ฿${rawFreebieDiscount.toLocaleString('th-TH')} บาท\n` : '') +
        (totalDiscount > 0 ? `• ส่วนลดรวมทั้งหมด: ฿${totalDiscount.toLocaleString('th-TH')} บาท\n` : '') +
        (netSellingPrice > 0 ? `• ราคาขายสุทธิ: ฿${netSellingPrice.toLocaleString('th-TH')} บาท\n` : '') +
        `• เงินจองที่รับ: ฿${depositNum.toLocaleString('th-TH')} บาท (${paymentMethod === 'mortgage' ? 'กู้ธนาคาร' : 'เงินสด'})\n` +
        (contractDueDate ? `• กำหนดทำสัญญา: ${contractDueDate}\n` : '') +
        `${freebieSummaryText}\n` +
        (notes.trim() ? `• หมายเหตุ/เงื่อนไขพิเศษ: ${notes.trim()}` : '');

      let leadId = effectiveCustomer?.id || null;

      // 2. Update existing lead or create new lead in leads table
      if (leadId) {
        const combinedNotes = effectiveCustomer.notes 
          ? `${bookingSummary}\n\n---\n${effectiveCustomer.notes}` 
          : bookingSummary;

        const { error: updateLeadError } = await supabase
          .from('leads')
          .update({
            status: 'Booked',
            crm_status: 'Booked — วางเงินจองแปลงแล้ว',
            auto_status: `จองแปลง ${plotId} (${projectName})`,
            project_name: projectName,
            interested_plot_name: plotId,
            notes: combinedNotes,
            sales_owner: agentName || 'ทีมขาย',
            updated_at: now.toISOString()
          })
          .eq('id', leadId);

        if (updateLeadError) {
          console.warn('Could not update lead table:', updateLeadError);
        }
      } else {
        // Create new lead in leads table
        const { data: newLeadData, error: createLeadErr } = await supabase
          .from('leads')
          .insert([{
            customer_name: effectiveName,
            phone: effectivePhone || null,
            project_name: projectName,
            channel: 'Walk in',
            source: 'Walk in',
            status: 'Booked',
            crm_status: 'Booked — วางเงินจองแปลงแล้ว',
            auto_status: `จองแปลง ${plotId} (${projectName})`,
            interested_plot_name: plotId,
            sales_owner: agentName || 'ทีมขาย',
            created_by_agent: agentName || 'ทีมขาย',
            notes: bookingSummary,
            created_at: now.toISOString(),
            updated_at: now.toISOString()
          }])
          .select('id')
          .single();

        if (createLeadErr) console.warn('Could not insert new lead:', createLeadErr);
        leadId = newLeadData?.id || null;
      }

      // 3. Sync plot_promotions table
      const resolvedPlotId = plotInfo?.id || plotId;
      if (resolvedPlotId) {
        try {
          // Remove existing promotions for this plot
          await supabase
            .from('plot_promotions')
            .delete()
            .or(`plot_id.eq.${resolvedPlotId},plot_id.eq.${plotId}`);

          // If promoMode === 'freebies', insert selected freebies with status 'pending'
          if (promoMode === 'freebies' && selectedFreebies.length > 0) {
            const promoRows = selectedFreebies.map(f => ({
              plot_id: resolvedPlotId,
              category: f.category || 'ทั่วไป',
              item_name: f.item_name,
              quantity: f.quantity || 1,
              status: 'pending',
              created_at: now.toISOString(),
              updated_at: now.toISOString()
            }));
            await supabase.from('plot_promotions').insert(promoRows);
          }
        } catch (promoSyncErr) {
          console.warn('Could not sync plot_promotions:', promoSyncErr);
        }
      }

      // 4. Try to record into lead_activities
      if (leadId) {
        try {
          await supabase
            .from('lead_activities')
            .insert([{
              customer_id: leadId,
              activity_type: 'note',
              result: 'contact_success',
              occurred_at: now.toISOString(),
              note: bookingSummary,
              next_follow_up_at: contractDueDate ? `${contractDueDate}T10:00:00+07:00` : null
            }]);
        } catch (err) {
          console.warn('Could not insert booking to lead_activities (non-blocking):', err);
        }
      }

      // 5. Try to update plot status in plots table
      try {
        await supabase
          .from('plots')
          .update({ 
            sale_status: 'Reserved',
            status: 'Booked',
            has_customer: true,
            highlight_note: `จอง: ${effectiveName}`
          })
          .or(`id.eq.${plotId},plot_name.eq.${plotId},id.eq.${projectName}-${plotId}`);
      } catch (err) {
        // Non-blocking
      }

      const successNotice = `บันทึกการจองแปลง "${plotId}" (${projectName}) ให้ "${effectiveName}" สำเร็จแล้ว! (ราคาขายสุทธิ: ฿${netSellingPrice.toLocaleString('th-TH')} บาท, เงินจอง: ฿${depositNum.toLocaleString('th-TH')} บาท)`;
      if (onSaved) onSaved(successNotice);
      onClose();
    } catch (err: any) {
      console.error('Error saving booking:', err);
      setErrorMsg(err.message || 'เกิดข้อผิดพลาดในการบันทึกการจอง');
    } finally {
      setIsSubmitting(false);
    }
  };

  const effectiveCustomer = selectedCustomer || initialCustomer;
  const leadOwnerObj = salesOwners.find(o => o.userId === effectiveCustomer?.ownerUserId || o.userId === effectiveCustomer?.owner_user_id);
  const leadOwnerName = leadOwnerObj?.displayName || effectiveCustomer?.salesOwner || effectiveCustomer?.sales_owner || effectiveCustomer?.agent_name || null;

  return (
    <>
      <div className="fixed inset-0 z-[300] flex items-center justify-center p-3 sm:p-6 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
        <div 
          className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[88vh] my-auto animate-in zoom-in-95 duration-200"
          role="dialog"
          aria-modal="true"
          aria-labelledby="booking-modal-title"
        >
          {/* Unified Sticky Header */}
          <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-sm border-b border-orange-100 shrink-0">
            <div className="flex items-center justify-between px-5 sm:px-6 py-3.5 sm:py-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-orange-600 flex items-center justify-center text-white shadow-sm shadow-orange-200 shrink-0">
                  <Tag size={20} />
                </div>
                <div>
                  <h3 id="booking-modal-title" className="text-base font-bold text-slate-800 flex items-center gap-2">
                    🏷️ บันทึกการจองแปลง (Booking)
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">
                    เลือกลูกค้าจาก Lead CRM, ล็อคแปลง และคำนวณราคาขายสุทธิ
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="ปิดหน้าต่าง"
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* 🔑 Quick Switch to Rental Program Banner */}
            {onSwitchToRental && (
              <div className="px-5 sm:px-6 py-2 bg-gradient-to-r from-blue-50 via-indigo-50 to-blue-50 border-t border-b border-indigo-100 flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
                  <Sparkles size={14} className="text-indigo-600" />
                  ลูกค้าต้องการ <b className="text-blue-700">"เช่า"</b> หรือ <b className="text-amber-700">"เช่าออม (Rent to Own)"</b> แทนใช่ไหม?
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onSwitchToRental();
                  }}
                  className="px-3 py-1 bg-gradient-to-r from-blue-700 to-indigo-700 hover:from-blue-800 hover:to-indigo-800 text-white rounded-lg font-bold text-xs shadow-2xs flex items-center gap-1 cursor-pointer transition-all shrink-0"
                >
                  🔑 สลับไปทำสัญญาเช่า (แบบ A, B, C) →
                </button>
              </div>
            )}
          </div>

          {/* Modal Form Body */}
          <form id="booking-form" onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 space-y-4">
            {errorMsg && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-medium flex items-start gap-2 animate-in fade-in">
                <AlertCircle size={16} className="text-rose-500 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* 👤 1. Customer Selection from Lead CRM / Walk-in */}
            <div className="bg-slate-50/90 p-4 rounded-2xl border border-slate-200 space-y-3">
              <LeadPicker
                selectedLead={effectiveCustomer}
                onSelectLead={handleLeadSelect}
                projectName={projectName}
                currentPlotName={plotId}
                isCreateNewMode={isNewCustomerMode}
                onToggleCreateNew={(isNew) => {
                  setIsNewCustomerMode(isNew);
                  if (isNew) {
                    setSelectedCustomer(null);
                    setWalkInName('');
                    setWalkInPhone('');
                    const defaultUser = currentUser?.displayName || currentUser?.username || currentUser?.name || salesOwners[0]?.displayName || 'ทีมขาย';
                    setAgentName(defaultUser);
                    setOwnerSource('current_user');
                  }
                }}
                label="เลือกลูกค้าผู้จองจาก Lead CRM"
                placeholder="🔍 พิมพ์ค้นหาชื่อ หรือ เบอร์โทรลูกค้า..."
              />

              {/* 🎯 แสดงข้อมูลเจ้าของ Lead เดิม */}
              {!isNewCustomerMode && effectiveCustomer && leadOwnerName && (
                <div className="flex items-center justify-between p-2.5 bg-blue-50/90 border border-blue-200/80 rounded-xl text-xs text-blue-950 font-medium animate-in fade-in">
                  <span className="flex items-center gap-1.5 text-blue-800">
                    <User size={14} className="text-blue-600 shrink-0" /> เจ้าของ Lead: <b className="text-blue-900 font-bold underline decoration-blue-300">{leadOwnerName}</b>
                  </span>
                  <span className="text-[10px] text-blue-600 bg-blue-100/90 px-2 py-0.5 rounded-full font-semibold border border-blue-200">
                    ผู้ดูแลในระบบ CRM
                  </span>
                </div>
              )}

              {isNewCustomerMode && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-orange-50/60 rounded-xl border border-orange-200/80 animate-in fade-in duration-200">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      ชื่อลูกค้า (Customer Name) <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={walkInName}
                      onChange={e => setWalkInName(e.target.value)}
                      placeholder="เช่น คุณสมชาย รักดี (ลูกค้า Walk-in)"
                      className="w-full text-xs font-bold bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-800 focus:ring-2 focus:ring-orange-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">เบอร์โทรศัพท์ (Phone)</label>
                    <input
                      type="tel"
                      value={walkInPhone}
                      onChange={e => setWalkInPhone(e.target.value)}
                      placeholder="08x-xxx-xxxx"
                      className="w-full text-xs font-bold bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-800 focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Project & Available Plot Selection */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1">
                  <Building2 size={13} className="text-orange-500" /> โครงการที่จอง <span className="text-rose-500">*</span>
                </label>
                <select
                  value={projectName}
                  onChange={(e) => {
                    setProjectName(e.target.value);
                    setPlotId('');
                  }}
                  className="w-full text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white"
                >
                  <option value="">-- เลือกโครงการ --</option>
                  {projects.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="plot-booking-select" className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1">
                  <Home size={13} className="text-orange-500" /> แปลงที่จอง (เฉพาะแปลงว่าง) <span className="text-rose-500">*</span>
                </label>
                <select
                  id="plot-booking-select"
                  aria-label="แปลงที่จอง"
                  value={plotId}
                  disabled={!projectName || loadingPlots}
                  onChange={(e) => setPlotId(e.target.value)}
                  className="w-full text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white disabled:opacity-50"
                >
                  <option value="">
                    {loadingPlots ? 'กำลังโหลดแปลงว่าง...' : availablePlots.length > 0 ? '-- เลือกแปลงที่ว่าง --' : '-- ไม่พบแปลงว่างในโครงการนี้ --'}
                  </option>
                  {availablePlots.map((plot) => (
                    <option key={plot.id} value={plot.id}>
                      {plot.plot_name || `แปลง ${plot.id}`} (แปลงว่าง)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* 🌟 1. Construction Information Card Preview (รูปที่ 2 จาก Project Map) */}
            {loadingPlotInfo ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 flex flex-col items-center justify-center gap-2 text-slate-400">
                <Loader2 size={24} className="animate-spin text-orange-500" />
                <span className="text-xs font-medium">กำลังโหลดข้อมูลรูปบ้านและความคืบหน้าจากฝ่ายก่อสร้าง...</span>
              </div>
            ) : plotInfo && (
              <div className="bg-gradient-to-br from-indigo-50/90 via-blue-50/60 to-white border border-indigo-100 rounded-2xl p-4 shadow-2xs relative overflow-hidden animate-in fade-in duration-300">
                <div className="flex items-center justify-between mb-3 border-b border-indigo-100/70 pb-2">
                  <h4 className="text-xs font-extrabold text-indigo-950 flex items-center gap-1.5">
                    <Pickaxe size={15} className="text-indigo-600" /> 
                    ข้อมูลจากฝ่ายก่อสร้าง (แปลง {plotInfo.plot_name || plotId})
                  </h4>
                  {plotInfo.statusInfo && (
                    <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold ${plotInfo.statusInfo.bg} ${plotInfo.statusInfo.color}`}>
                      {plotInfo.statusInfo.label}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
                  {/* House Picture with Lightbox zoom button */}
                  {(plotInfo.overview_image_url || plotInfo.current_image_url || plotInfo.cover_image) ? (
                    <div 
                      className="sm:col-span-5 aspect-video sm:aspect-4/3 rounded-xl overflow-hidden border border-indigo-200/80 shadow-xs relative group cursor-pointer bg-slate-100"
                      onClick={() => setFullImageUrl(plotInfo.overview_image_url || plotInfo.current_image_url || plotInfo.cover_image)}
                      title="คลิกเพื่อดูรูปขนาดใหญ่"
                    >
                      <img 
                        src={plotInfo.overview_image_url || plotInfo.current_image_url || plotInfo.cover_image} 
                        alt={`รูปหน้าบ้านแปลง ${plotId}`} 
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" 
                      />
                      <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="text-white text-[11px] font-bold bg-black/60 px-2.5 py-1 rounded-full backdrop-blur-xs flex items-center gap-1">
                          <Maximize2 size={12} /> ดูรูปใหญ่
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="sm:col-span-5 aspect-video sm:aspect-4/3 rounded-xl border border-dashed border-indigo-200 bg-indigo-50/50 flex flex-col items-center justify-center text-indigo-300 text-xs">
                      <Home size={28} className="mb-1 text-indigo-400" />
                      <span>ยังไม่มีรูปภาพหน้าบ้าน</span>
                    </div>
                  )}

                  {/* House Details & Construction Progress */}
                  <div className="sm:col-span-7 space-y-3">
                    {/* Progress Bar */}
                    <div>
                      <div className="flex justify-between items-center text-xs mb-1">
                        <span className="font-bold text-indigo-900">ความคืบหน้าก่อสร้าง</span>
                        <span className="font-black text-indigo-700">{plotInfo.progress || 0}%</span>
                      </div>
                      <div className="w-full bg-slate-200/80 rounded-full h-2 overflow-hidden shadow-inner">
                        <div 
                          className="bg-indigo-600 h-full rounded-full transition-all duration-700 ease-out" 
                          style={{ width: `${Math.min(100, Math.max(0, plotInfo.progress || 0))}%` }}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-white/90 p-2 rounded-xl border border-indigo-100/80 shadow-2xs">
                        <span className="text-[10px] text-slate-500 font-bold block">แบบบ้าน</span>
                        <span className="font-bold text-indigo-950 truncate block">
                          {plotInfo.house_types?.type_name || plotInfo.house_model || 'แบบบ้านมาตรฐาน'}
                        </span>
                      </div>

                      <div className="bg-white/90 p-2 rounded-xl border border-indigo-100/80 shadow-2xs">
                        <span className="text-[10px] text-slate-500 font-bold block">ขนาดที่ดิน</span>
                        <span className="font-bold text-indigo-950 block">
                          {plotInfo.land_size ? `${plotInfo.land_size} ตร.ว.` : '-'}
                        </span>
                      </div>

                      <div className="col-span-2 bg-white/90 p-2.5 rounded-xl border border-indigo-100/80 shadow-2xs flex items-center justify-between">
                        <div>
                          <span className="text-[10px] text-slate-500 font-bold block">ราคาขายที่ตั้งไว้ในระบบ</span>
                          <span className="font-black text-sm text-emerald-600 font-mono">
                            {plotInfo.selling_price ? `฿${Number(plotInfo.selling_price).toLocaleString('th-TH')}` : 'ยังไม่ระบุราคา'}
                          </span>
                        </div>
                        {plotInfo.sale_status === 'ready_for_sale' ? (
                          <span className="text-[11px] text-emerald-700 font-bold flex items-center gap-1 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-200">
                            <CheckCircle size={12} /> พร้อมขาย/รอโอน
                          </span>
                        ) : (plotInfo.is_completed || Math.round(plotInfo.progress || 0) === 100) ? (
                          <span className="text-[11px] text-emerald-700 font-bold flex items-center gap-1 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-200">
                            <CheckCircle size={12} /> ก่อสร้างเสร็จสิ้น
                          </span>
                        ) : (
                          <span className="text-[11px] text-indigo-700 font-bold flex items-center gap-1 bg-indigo-50 px-2 py-1 rounded-lg border border-indigo-200">
                            <Pickaxe size={12} /> อยู่ระหว่างก่อสร้าง
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 🌟 2. Promotion Mode Selection (รับของแถม vs ไม่รับแถมเปลี่ยนเป็นส่วนลดเงินสดทั้งหมด) */}
            <div className="bg-slate-50/90 p-4 rounded-2xl border border-slate-200 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-200/80 pb-2.5">
                <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <Gift size={16} className="text-orange-600" />
                  โปรโมชั่น & ของแถมโครงการ (Promotions & Freebies)
                </h4>
                {promoMode === 'freebies' ? (
                  <span className="text-[11px] font-bold text-orange-800 bg-orange-100 border border-orange-200 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                    <Gift size={12} /> รับของแถม {selectedFreebies.length} รายการ
                  </span>
                ) : (
                  <span className="text-[11px] font-bold text-emerald-800 bg-emerald-100 border border-emerald-200 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                    <Percent size={12} /> เปลี่ยนเป็นส่วนลดเงินสด (ไม่รับของแถม)
                  </span>
                )}
              </div>

              {/* Mode Toggle Switch Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setPromoMode('freebies')}
                  className={`p-3 rounded-xl border text-left flex items-start gap-3 transition-all cursor-pointer ${
                    promoMode === 'freebies'
                      ? 'bg-orange-50/90 border-orange-400 ring-2 ring-orange-500/20 shadow-xs'
                      : 'bg-white border-slate-200 hover:bg-slate-100/70 text-slate-600'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    promoMode === 'freebies' ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                    <Gift size={18} />
                  </div>
                  <div>
                    <span className="text-xs font-bold block text-slate-900">
                      🎁 รับแพ็กเกจของแถม
                    </span>
                    <span className="text-[10px] text-slate-500">
                      เลือกของแถมตามหมวดหมู่ ส่งต่อให้ฝ่ายจัดซื้อ/ติดตั้ง
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setPromoMode('discount')}
                  className={`p-3 rounded-xl border text-left flex items-start gap-3 transition-all cursor-pointer ${
                    promoMode === 'discount'
                      ? 'bg-emerald-50/90 border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs'
                      : 'bg-white border-slate-200 hover:bg-slate-100/70 text-slate-600'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    promoMode === 'discount' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                    <Percent size={18} />
                  </div>
                  <div>
                    <span className="text-xs font-bold block text-slate-900">
                      💵 ไม่รับของแถม (เปลี่ยนเป็นส่วนลด)
                    </span>
                    <span className="text-[10px] text-slate-500">
                      ไม่แถมของใดๆ — นำมูลค่าไปหักลดราคาบ้านทันที
                    </span>
                  </div>
                </button>
              </div>

              {/* 🎁 MODE A: Freebies Checklist by Categories */}
              {promoMode === 'freebies' && (
                <div className="space-y-3 pt-1 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-600 font-bold text-[11px]">
                      คลิกเลือก/แก้ไขรายการของแถมที่จะมอบให้ลูกค้า:
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={selectAllMasterFreebies}
                        className="text-[10px] font-bold text-blue-700 hover:text-blue-900 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-lg hover:bg-blue-100 transition-colors cursor-pointer"
                      >
                        เลือกทั้งหมด
                      </button>
                      <button
                        type="button"
                        onClick={clearAllFreebies}
                        className="text-[10px] font-bold text-slate-600 hover:text-slate-800 bg-white border border-slate-200 px-2 py-0.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                      >
                        ล้างทั้งหมด
                      </button>
                    </div>
                  </div>

                  {/* Render Categories */}
                  <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                    {MASTER_FREEBIES_CATALOG.map((group) => {
                      return (
                        <div key={group.category} className="bg-white p-3 rounded-xl border border-slate-200/80 shadow-2xs space-y-2">
                          <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                            <span className="flex items-center gap-1.5">
                              <span>{group.icon}</span> {group.category}
                            </span>
                            <span className="text-[10px] text-slate-400 font-medium">
                              ({selectedFreebies.filter(f => f.category === group.category).length}/{group.items.length})
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                            {group.items.map((item) => {
                              const isChecked = selectedFreebies.some(f => f.item_name === item.name);
                              const currentSelected = selectedFreebies.find(f => f.item_name === item.name);
                              const qty = currentSelected?.quantity || item.defaultQty;

                              return (
                                <div
                                  key={item.name}
                                  className={`p-2 rounded-lg border text-xs flex items-center justify-between gap-2 transition-all ${
                                    isChecked
                                      ? 'bg-orange-50/50 border-orange-300 font-bold text-slate-800 shadow-2xs'
                                      : 'bg-slate-50/50 border-slate-200 text-slate-500 font-normal hover:border-slate-300'
                                  }`}
                                >
                                  <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => toggleFreebie(group.category, item.name, item.defaultQty)}
                                      className="rounded text-orange-600 focus:ring-orange-500 cursor-pointer"
                                    />
                                    <span className="truncate text-[11px]">{item.name}</span>
                                  </label>

                                  {isChecked && (
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        type="button"
                                        onClick={() => updateFreebieQty(item.name, -1)}
                                        className="w-5 h-5 rounded bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 flex items-center justify-center font-bold text-[10px] cursor-pointer"
                                      >
                                        -
                                      </button>
                                      <span className="text-[11px] font-black text-orange-900 w-4 text-center">
                                        {qty}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => updateFreebieQty(item.name, 1)}
                                        className="w-5 h-5 rounded bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 flex items-center justify-center font-bold text-[10px] cursor-pointer"
                                      >
                                        +
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}

                    {/* Custom Freebies Added outside Master Catalog */}
                    {selectedFreebies.some(f => !MASTER_FREEBIES_CATALOG.some(cat => cat.items.some(it => it.name === f.item_name))) && (
                      <div className="bg-amber-50/50 p-3 rounded-xl border border-amber-200 shadow-2xs space-y-2">
                        <span className="text-xs font-bold text-amber-900 flex items-center gap-1">
                          <Sparkles size={13} className="text-amber-600" /> รายการของแถมพิเศษเพิ่มเติม
                        </span>
                        <div className="space-y-1.5">
                          {selectedFreebies
                            .filter(f => !MASTER_FREEBIES_CATALOG.some(cat => cat.items.some(it => it.name === f.item_name)))
                            .map(customItem => (
                              <div key={customItem.item_name} className="flex items-center justify-between p-2 bg-white rounded-lg border border-amber-200 text-xs">
                                <span className="font-bold text-slate-800">
                                  [{customItem.category}] {customItem.item_name} ({customItem.quantity} ชิ้น)
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeFreebie(customItem.item_name)}
                                  className="text-rose-500 hover:text-rose-700 p-1 cursor-pointer"
                                  title="ลบรายการนี้"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Add Custom Freebie Form */}
                  {!showAddCustomFreebie ? (
                    <button
                      type="button"
                      onClick={() => setShowAddCustomFreebie(true)}
                      className="w-full py-2 border border-dashed border-slate-300 hover:border-orange-400 text-xs font-bold text-slate-600 hover:text-orange-700 rounded-xl bg-white hover:bg-orange-50/40 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Plus size={14} className="text-orange-500" /> + เพิ่มของแถมพิเศษนอกเหนือจากแคตตาล็อก
                    </button>
                  ) : (
                    <div className="p-3 bg-orange-50/70 border border-orange-200 rounded-xl space-y-2.5 animate-in fade-in">
                      <div className="flex items-center justify-between text-xs font-bold text-orange-900">
                        <span>ระบุของแถมพิเศษ</span>
                        <button type="button" onClick={() => setShowAddCustomFreebie(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                          <X size={14} />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                        <div className="sm:col-span-4">
                          <select
                            value={customFreebieCategory}
                            onChange={e => setCustomFreebieCategory(e.target.value)}
                            className="w-full text-xs font-medium bg-white border border-slate-300 rounded-lg px-2.5 py-1.5"
                          >
                            <option value="เครื่องใช้ไฟฟ้า">เครื่องใช้ไฟฟ้า</option>
                            <option value="เฟอร์นิเจอร์ & ห้องโถง">เฟอร์นิเจอร์</option>
                            <option value="ชุดห้องนอน">ชุดห้องนอน</option>
                            <option value="งานระบบ & ภายนอกบ้าน">ภายนอก/งานระบบ</option>
                            <option value="ของแถมพิเศษ">ของแถมพิเศษ</option>
                          </select>
                        </div>
                        <div className="sm:col-span-6">
                          <input
                            type="text"
                            value={customFreebieName}
                            onChange={e => setCustomFreebieName(e.target.value)}
                            placeholder="ระบุชื่อของแถม เช่น iPhone 16 Pro Max"
                            className="w-full text-xs font-bold bg-white border border-slate-300 rounded-lg px-2.5 py-1.5"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <input
                            type="number"
                            min="1"
                            value={customFreebieQty}
                            onChange={e => setCustomFreebieQty(parseInt(e.target.value) || 1)}
                            className="w-full text-xs font-bold bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-center"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setShowAddCustomFreebie(false)}
                          className="px-2.5 py-1 text-xs text-slate-600 bg-white border border-slate-200 rounded-lg cursor-pointer"
                        >
                          ยกเลิก
                        </button>
                        <button
                          type="button"
                          onClick={handleAddCustomFreebie}
                          className="px-3 py-1 text-xs font-bold text-white bg-orange-600 hover:bg-orange-700 rounded-lg cursor-pointer"
                        >
                          บันทึกรายการนี้
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 💵 MODE B: Discount in lieu of Freebies (ไม่แถมอะไรเลย เปลี่ยนเป็นส่วนลดเงินสด) */}
              {promoMode === 'discount' && (
                <div className="p-4 bg-emerald-50/80 border border-emerald-200 rounded-xl space-y-3 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                      <DollarSign size={15} className="text-emerald-600" /> ระบุมูลค่าส่วนลดจากการไม่รับของแถม
                    </span>
                    <span className="text-[10px] font-black text-emerald-800 bg-emerald-200/80 px-2 py-0.5 rounded-md border border-emerald-300">
                      บ้านเปล่า (No Freebies)
                    </span>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-emerald-900 mb-1">
                      มูลค่าส่วนลดที่จะนำไปหักลดราคาบ้าน (บาท) <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={freebieDiscount}
                      onChange={e => setFreebieDiscount(e.target.value)}
                      placeholder="เช่น 50,000"
                      className="w-full text-sm font-black text-emerald-950 bg-white border-2 border-emerald-300 rounded-xl px-3 py-2 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    />
                  </div>

                  {/* Quick preset buttons */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-emerald-800 font-semibold">ยอดด่วน:</span>
                    {['30000', '50000', '70000', '100000'].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setFreebieDiscount(Number(amt).toLocaleString('en-US'))}
                        className="px-2.5 py-1 text-[10px] font-bold bg-white hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-lg transition-colors cursor-pointer"
                      >
                        ฿{Number(amt).toLocaleString()}
                      </button>
                    ))}
                  </div>

                  <p className="text-[10px] text-emerald-800 font-medium">
                    💡 ระบบจะไม่สร้างรายการส่งมอบของแถมในระบบ และนำยอด ฿{rawFreebieDiscount.toLocaleString('th-TH')} บาทนี้ไปคำนวณหักลดราคาบ้านสุทธิให้อัตโนมัติ
                  </p>
                </div>
              )}
            </div>

            {/* 🌟 3. Pricing & Net Selling Price Calculation Section */}
            <div className="bg-slate-50/80 p-4 rounded-2xl border border-slate-200 space-y-3.5">
              <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5 border-b border-slate-200/80 pb-2">
                <Receipt size={14} className="text-orange-600" /> ข้อมูลราคาขายและคำนวณราคาหลังหักส่วนลด
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center justify-between">
                    <span className="flex items-center gap-1"><DollarSign size={13} className="text-slate-500" /> ราคาก่อนส่วนลด (บาท) <span className="text-rose-500">*</span></span>
                    {plotInfo?.selling_price && <span className="text-[10px] text-emerald-600 font-semibold">(ดึงจากระบบ)</span>}
                  </label>
                  <input
                    type="text"
                    value={listPrice}
                    onChange={(e) => setListPrice(e.target.value)}
                    placeholder="เช่น 2,793,000"
                    className="w-full text-xs font-bold bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:ring-2 focus:ring-orange-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                    <Tag size={13} className="text-rose-500" /> ส่วนลดโปรโมชั่นทั่วไป (บาท)
                  </label>
                  <input
                    type="text"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                    placeholder="0"
                    className="w-full text-xs font-bold bg-white border border-slate-200 rounded-xl px-3 py-2 text-rose-700 focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>

              {/* Breakdown if Freebie Discount is active */}
              {promoMode === 'discount' && rawFreebieDiscount > 0 && (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 bg-white rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-500 font-bold block">ส่วนลดโปรโมชั่นทั่วไป</span>
                    <span className="font-bold text-slate-700">฿{rawDiscount.toLocaleString('th-TH')} บาท</span>
                  </div>
                  <div className="p-2.5 bg-emerald-50 rounded-xl border border-emerald-200">
                    <span className="text-[10px] text-emerald-700 font-bold block">ส่วนลดจากการไม่รับของแถม</span>
                    <span className="font-bold text-emerald-800">฿{rawFreebieDiscount.toLocaleString('th-TH')} บาท</span>
                  </div>
                </div>
              )}

              {/* 🌟 Dedicated Real-Time Highlight: ราคาหลังหักส่วนลด (ราคาขายจริงสุทธิ) */}
              <div className="p-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-sm flex flex-wrap items-center justify-between gap-2 animate-in fade-in duration-200">
                <div>
                  <span className="text-[11px] font-bold text-emerald-100 uppercase tracking-wider block">
                    ราคาขายสุทธิหลังหักส่วนลด (Net Price)
                  </span>
                  <span className="text-xs text-emerald-100">
                    {totalDiscount > 0 ? `หักส่วนลดรวม ฿${totalDiscount.toLocaleString('th-TH')} บาท แล้ว` : 'ยังไม่มีการหักส่วนลด'}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-xl sm:text-2xl font-black font-mono tracking-tight text-white drop-shadow-xs">
                    ฿{netSellingPrice.toLocaleString('th-TH')}
                  </span>
                  <span className="text-xs font-bold text-emerald-100 ml-1">บาท</span>
                </div>
              </div>

              {/* Deposit Field */}
              <div>
                <label className="block text-xs font-bold text-orange-800 mb-1 flex items-center gap-1">
                  <Receipt size={13} className="text-orange-600" /> เงินจองที่รับ (บาท) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={deposit}
                  onChange={(e) => setDeposit(e.target.value)}
                  placeholder="10000"
                  className="w-full text-xs font-extrabold bg-white border-2 border-orange-300 rounded-xl px-3 py-2 text-orange-950 focus:ring-2 focus:ring-orange-500"
                />
              </div>
            </div>

            {/* Payment Method & Contract Date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1">
                  <CreditCard size={13} className="text-indigo-500" /> วิธีการชำระเงิน <span className="text-rose-500">*</span>
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as any)}
                  className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white"
                >
                  <option value="mortgage">🏦 ยื่นกู้ธนาคาร (Mortgage)</option>
                  <option value="cash">💵 ชำระเงินสด / โอนเงิน (Cash)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1">
                  <Calendar size={13} className="text-emerald-500" /> กำหนดวันทำสัญญาจะซื้อจะขาย
                </label>
                <input
                  type="date"
                  value={contractDueDate}
                  onChange={(e) => setContractDueDate(e.target.value)}
                  className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white"
                />
              </div>
            </div>

            {/* Sales Closer */}
            <div className="bg-slate-50/90 p-3.5 rounded-2xl border border-slate-200/80 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-1.5">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <User size={13} className="text-slate-600" /> Sales ผู้ปิดการขาย / ผู้บันทึกสัญญา <span className="text-rose-500">*</span>
                </label>
                {ownerSource === 'current_user' && (
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100/80 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1 animate-in fade-in">
                    <Sparkles size={11} className="text-emerald-600" /> ผู้ใช้ที่ล็อกอินอยู่ (คุณ)
                  </span>
                )}
                {ownerSource === 'manual' && (
                  <span className="text-[10px] font-bold text-amber-700 bg-amber-100/80 border border-amber-200 px-2 py-0.5 rounded-full animate-in fade-in">
                    ระบุผู้ปิดการขายกำหนดเอง
                  </span>
                )}
              </div>
              <select
                value={agentName}
                onChange={(e) => {
                  setAgentName(e.target.value);
                  setOwnerSource('manual');
                }}
                className="w-full text-xs font-bold bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500 shadow-2xs"
              >
                {salesOwners.length > 0 ? (
                  <>
                    {agentName && !salesOwners.some(o => o.displayName === agentName) && (
                      <option value={agentName}>{agentName}</option>
                    )}
                    {salesOwners.map(o => (
                      <option key={o.userId} value={o.displayName}>{o.displayName}</option>
                    ))}
                  </>
                ) : (
                  <option value={agentName || "ทีมขาย"}>{agentName || "ทีมขาย"}</option>
                )}
              </select>
              <div className="text-[10px] text-slate-500 font-medium flex items-center justify-between flex-wrap gap-1">
                <span>บันทึกชื่อผู้ใช้งานที่ปิดยอดจองนี้ (สามารถเลือกเปลี่ยนชื่อได้หากปิดการขายแทน)</span>
                {leadOwnerName && leadOwnerName !== agentName && (
                  <span className="text-blue-700 font-semibold bg-blue-50 border border-blue-200/60 px-1.5 py-0.5 rounded">
                    Lead เดิม: {leadOwnerName}
                  </span>
                )}
              </div>
            </div>

            {/* Special Notes / Promotion */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1">
                <FileText size={13} className="text-slate-500" /> หมายเหตุ / ของแถม / เงื่อนไขพิเศษ
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="ระบุโปรโมชั่น เช่น ฟรีค่าโอน, แอร์ 2 เครื่อง, ของแถมตามใบจอง..."
                className="w-full text-xs font-normal bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white"
              />
            </div>
          </form>

          {/* Sticky Footer Actions */}
          <div className="sticky bottom-0 z-20 px-5 sm:px-6 py-3.5 border-t border-slate-100 bg-slate-50/95 backdrop-blur-sm flex items-center justify-end gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 bg-white border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors disabled:opacity-50 cursor-pointer"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              form="booking-form"
              disabled={isSubmitting}
              className="px-5 py-2 text-xs font-bold text-white bg-orange-600 hover:bg-orange-700 rounded-xl shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  กำลังบันทึกการจอง...
                </>
              ) : (
                <>
                  <CheckCircle2 size={14} />
                  ยืนยันการจองแปลง
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 🌟 Lightbox Image Zoom Modal */}
      {fullImageUrl && (
        <div 
          className="fixed inset-0 z-[400] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setFullImageUrl(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] bg-transparent rounded-2xl overflow-hidden shadow-2xl flex flex-col items-center">
            <button
              type="button"
              onClick={() => setFullImageUrl(null)}
              className="absolute top-3 right-3 p-2 text-white bg-black/60 hover:bg-black/80 rounded-full transition-colors cursor-pointer z-10"
              aria-label="ปิดรูปภาพ"
            >
              <X size={20} />
            </button>
            <img 
              src={fullImageUrl} 
              alt="รูปหน้าบ้านขนาดใหญ่" 
              className="max-h-[85vh] w-auto object-contain rounded-xl shadow-2xl" 
            />
          </div>
        </div>
      )}
    </>
  );
}

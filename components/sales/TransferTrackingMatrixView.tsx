'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import {
  FileSpreadsheet, Search, Filter, Calendar, Building2, Download,
  CheckCircle2, XCircle, Clock, AlertTriangle, ArrowLeft, Home,
  RefreshCw, Check, X, Eye, ExternalLink, Tag, ChevronDown, CheckSquare,
  Square, ShieldCheck, Printer
} from 'lucide-react';
import SalesOverlay from './SalesOverlay';

interface TransferTrackingMatrixViewProps {
  onBack?: () => void;
  onViewPlot?: (plot: any) => void;
  initialProjectName?: string;
}

export default function TransferTrackingMatrixView({
  onBack,
  onViewPlot,
  initialProjectName
}: TransferTrackingMatrixViewProps) {
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>(initialProjectName || 'all');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'waiting' | 'transferred' | 'rental'>('all');
  const [includeUnscheduled, setIncludeUnscheduled] = useState(true);

  // Date Range: Month to Month (defaults to October 2026 / current date)
  const currentYear = 2026;
  const currentMonth = 10; // ตุลาคม

  const [fromMonth, setFromMonth] = useState<number>(currentMonth);
  const [fromYear, setFromYear] = useState<number>(currentYear);
  const [toMonth, setToMonth] = useState<number>(currentMonth);
  const [toYear, setToYear] = useState<number>(currentYear);
  const [filterAllMonths, setFilterAllMonths] = useState<boolean>(false);

  // Raw data collections
  const [plots, setPlots] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [taskAssignments, setTaskAssignments] = useState<any[]>([]);
  const [taskTemplates, setTaskTemplates] = useState<any[]>([]);
  const [defects, setDefects] = useState<any[]>([]);
  const [promotions, setPromotions] = useState<any[]>([]);
  const [plotOverallProgress, setPlotOverallProgress] = useState<any[]>([]);

  // Preview Image Lightbox
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [updatingPlotId, setUpdatingPlotId] = useState<string | null>(null);

  // Month Names in Thai
  const THAI_MONTHS = [
    { value: 1, name: 'มกราคม' },
    { value: 2, name: 'กุมภาพันธ์' },
    { value: 3, name: 'มีนาคม' },
    { value: 4, name: 'เมษายน' },
    { value: 5, name: 'พฤษภาคม' },
    { value: 6, name: 'มิถุนายน' },
    { value: 7, name: 'กรกฎาคม' },
    { value: 8, name: 'สิงหาคม' },
    { value: 9, name: 'กันยายน' },
    { value: 10, name: 'ตุลาคม' },
    { value: 11, name: 'พฤศจิกายน' },
    { value: 12, name: 'ธันวาคม' },
  ];

  // Available Years
  const YEARS = [2025, 2026, 2027, 2028];

  // Fetch initial project list
  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const { data } = await supabase.from('projects').select('id, name, is_closed').order('name');
        if (data) setProjects(data);
      } catch (err) {
        console.error('Error fetching projects:', err);
      }
    };
    fetchProjects();
  }, []);

  // Helper: Extract expected transfer date from notes (e.g. "คาดโอน 17 ต.ค. 69")
  const extractExpectedDate = (text?: string | null): string | null => {
    if (!text) return null;
    const months: Record<string, string> = {
      'ม.ค.': '01', 'ก.พ.': '02', 'มี.ค.': '03', 'เม.ย.': '04', 'พ.ค.': '05', 'มิ.ย.': '06',
      'ก.ค.': '07', 'ส.ค.': '08', 'ก.ย.': '09', 'ต.ค.': '10', 'พ.ย.': '11', 'ธ.ค.': '12'
    };
    const match = text.match(/(?:คาดโอน|โอน|นัดโอน)\s*([0-9]{1,2})\s*([^\s]+)\s*([0-9]{2,4})/);
    if (match) {
      const day = String(match[1]).padStart(2, '0');
      const mName = match[2];
      let mNum = months[mName];
      if (!mNum) {
        const foundKey = Object.keys(months).find(k => mName.includes(k.replace('.', '')));
        if (foundKey) mNum = months[foundKey];
      }
      let year = Number(match[3]);
      if (year < 100) year += 2500;
      if (year > 2500) year -= 543;
      if (mNum) return `${year}-${mNum}-${day}`;
    }
    return null;
  };

  // Helper: Extract customer name from highlight_note
  const extractCustomerName = (note?: string | null): string | null => {
    if (!note) return null;
    const mCust = note.match(/ลูกค้า:\s*([^(]+)/);
    if (mCust) return mCust[1].trim();
    const mRent = note.match(/(?:เช่า|จองเช่า):[^(]*\(([^)]+)\)/);
    if (mRent) return mRent[1].trim();
    return null;
  };

  // Comprehensive Data Fetching
  const fetchAllMatrixData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Projects to filter closed ones
      const { data: projData } = await supabase.from('projects').select('name, is_closed');
      const closedProjects = new Set((projData || []).filter(p => p.is_closed).map(p => p.name));

      // 2. Fetch Task Templates
      const { data: tTemplates } = await supabase
        .from('task_templates')
        .select('id, task_name');
      setTaskTemplates(tTemplates || []);

      // 3. Fetch Plots
      let plotQuery = supabase
        .from('plots')
        .select('*, house_types(type_name, is_infrastructure)');
      
      if (selectedProject && selectedProject !== 'all') {
        plotQuery = plotQuery.eq('project_name', selectedProject);
      }

      const { data: pData } = await plotQuery;

      // 4. Fetch Sales
      const { data: sData } = await supabase
        .from('sales')
        .select('*');
      const allSales = sData || [];
      setSales(allSales);

      // 5. Fetch Leads
      const { data: lData } = await supabase
        .from('leads')
        .select('*');
      const allLeads = lData || [];
      setLeads(allLeads);

      // 🎯 STRICT FILTER: Exactly matching "รายละเอียดบ้านที่รอโอน" (Waiting for Transfer) - Exactly 17 plots
      // Only include plots that:
      // - Belong to active projects (not is_closed)
      // - Are not infrastructure
      // - Have an active booking/sale (not cancelled), OR are an active rental (current_tenant_name), OR have customer reserved
      const qualifiedPlots = (pData || []).filter(p => {
        // Exclude closed projects
        if (closedProjects.has(p.project_name)) return false;

        // Exclude infrastructure
        if (p.house_types?.is_infrastructure || p.house_types?.type_name === 'สาธารณูปโภค') return false;

        // 1. Rental check (บ้านเช่า)
        const isRental = Boolean(
          p.current_tenant_name ||
          p.rental_program ||
          p.sale_status === 'Rented' ||
          (p.highlight_note && /เช่า:|จองเช่า:/i.test(p.highlight_note))
        );

        // 2. Active Customer booking waiting for transfer (บ้านรอโอนขาย)
        const plotSales = allSales.filter(sl => sl.plot_id === p.id && sl.contract_status !== 'Cancelled');
        const isNotTransferred = (p.sale_status || '').toLowerCase() !== 'transferred';
        const hasCustomerBooking = Boolean(p.has_customer && isNotTransferred);
        const isReservedStatus = ['booked', 'contracted', 'reserved', 'transfer_pending'].includes((p.sale_status || '').toLowerCase());
        const hasWaitingSale = plotSales.some(sl => !['transferred', 'handover'].includes((sl.stage || sl.contract_status || '').toLowerCase()));

        // Exactly 17 plots: 12 waiting transfer sales + 5 rentals
        return isRental || hasCustomerBooking || isReservedStatus || hasWaitingSale;
      });

      setPlots(qualifiedPlots);

      const plotIds = qualifiedPlots.map(p => p.id);
      if (plotIds.length === 0) {
        setTaskAssignments([]);
        setDefects([]);
        setPromotions([]);
        setPlotOverallProgress([]);
        setLoading(false);
        return;
      }

      // Chunk helper for batch queries
      const chunkArray = (arr: any[], size: number) => 
        Array.from({ length: Math.ceil(arr.length / size) }, (v, i) => arr.slice(i * size, i * size + size));
      const chunks = chunkArray(plotIds, 100);

      // 6. Fetch Task Assignments
      let allAssignments: any[] = [];
      for (const chunk of chunks) {
        const { data: aData } = await supabase
          .from('plot_task_assignments')
          .select('plot_id, task_template_id, current_progress, actual_start_date, actual_end_date')
          .in('plot_id', chunk);
        if (aData) allAssignments = [...allAssignments, ...aData];
      }
      setTaskAssignments(allAssignments);

      // 7. Fetch Defects
      let allDefects: any[] = [];
      for (const chunk of chunks) {
        const { data: dData } = await supabase
          .from('defects')
          .select('id, plot_id, status, progress, defect_stage, inspection_round')
          .in('plot_id', chunk);
        if (dData) allDefects = [...allDefects, ...dData];
      }
      setDefects(allDefects);

      // 8. Fetch Promotions (for termite / ของแถม)
      let allPromos: any[] = [];
      for (const chunk of chunks) {
        const { data: prData } = await supabase
          .from('plot_promotions')
          .select('id, plot_id, category, item_name, status, delivery_date, remarks')
          .in('plot_id', chunk);
        if (prData) allPromos = [...allPromos, ...prData];
      }
      setPromotions(allPromos);

      // 9. Fetch Overall Progress from vw_plot_overall_status
      let allOverall: any[] = [];
      for (const chunk of chunks) {
        const { data: oData } = await supabase
          .from('vw_plot_overall_status')
          .select('plot_id, actual_avg')
          .in('plot_id', chunk);
        if (oData) allOverall = [...allOverall, ...oData];
      }
      setPlotOverallProgress(allOverall);

    } catch (err) {
      console.error('Error fetching matrix data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllMatrixData();
  }, [selectedProject]);

  // Helper: check rental
  const isRentalPlot = (plot: any) => Boolean(
    plot.current_tenant_name ||
    plot.rental_program ||
    plot.sale_status === 'Rented' ||
    (plot.highlight_note && /เช่า:/i.test(plot.highlight_note))
  );

  // Helper: format Date DD/MM/YYYY
  const formatDateDMY = (dateStr?: string | null) => {
    if (!dateStr || dateStr === 'ยังไม่ระบุ') return '-';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    } catch {
      return dateStr;
    }
  };

  // 🖱️ One-Click Toggle Handlers (Everyone can click to toggle)
  const handleToggleSandwashCoating = async (plotId: string, currentVal: boolean) => {
    try {
      setUpdatingPlotId(plotId);
      const targetPlot = plots.find(p => p.id === plotId);
      if (!targetPlot) return;
      const nextVal = !currentVal;
      const oldNotes = targetPlot.handover_notes || '';
      const cleanNotes = oldNotes.replace(/\[sandwash_coating:(done|pending)\]/g, '').trim();
      const newNotes = cleanNotes 
        ? `${cleanNotes} [sandwash_coating:${nextVal ? 'done' : 'pending'}]` 
        : `[sandwash_coating:${nextVal ? 'done' : 'pending'}]`;

      setPlots(prev => prev.map(p => p.id === plotId ? { ...p, handover_notes: newNotes } : p));
      const { error } = await supabase.from('plots').update({ handover_notes: newNotes }).eq('id', plotId);
      if (error) {
        console.error('Error updating sandwash coating:', error);
        setPlots(prev => prev.map(p => p.id === plotId ? { ...p, handover_notes: oldNotes } : p));
      }
    } catch (err) {
      console.error('Toggle error:', err);
    } finally {
      setUpdatingPlotId(null);
    }
  };

  const handleToggleConstructionFinished = async (plotId: string, currentVal: boolean) => {
    try {
      setUpdatingPlotId(plotId);
      const targetPlot = plots.find(p => p.id === plotId);
      if (!targetPlot) return;
      const nextVal = !currentVal;
      const oldNotes = targetPlot.handover_notes || '';
      const cleanNotes = oldNotes.replace(/\[construction_finished:(done|pending)\]/g, '').trim();
      const newNotes = cleanNotes 
        ? `${cleanNotes} [construction_finished:${nextVal ? 'done' : 'pending'}]` 
        : `[construction_finished:${nextVal ? 'done' : 'pending'}]`;

      setPlots(prev => prev.map(p => p.id === plotId ? { ...p, handover_notes: newNotes } : p));
      const { error } = await supabase.from('plots').update({ handover_notes: newNotes }).eq('id', plotId);
      if (error) {
        console.error('Error updating construction finished:', error);
        setPlots(prev => prev.map(p => p.id === plotId ? { ...p, handover_notes: oldNotes } : p));
      }
    } catch (err) {
      console.error('Toggle error:', err);
    } finally {
      setUpdatingPlotId(null);
    }
  };

  const handleToggleCloseConstruction = async (plotId: string, currentVal: boolean) => {
    try {
      setUpdatingPlotId(plotId);
      const targetPlot = plots.find(p => p.id === plotId);
      if (!targetPlot) return;
      const nextVal = !currentVal;
      const oldNotes = targetPlot.handover_notes || '';
      const cleanNotes = oldNotes.replace(/\[close_construction:(done|pending)\]/g, '').trim();
      const newNotes = cleanNotes 
        ? `${cleanNotes} [close_construction:${nextVal ? 'done' : 'pending'}]` 
        : `[close_construction:${nextVal ? 'done' : 'pending'}]`;

      setPlots(prev => prev.map(p => p.id === plotId ? { ...p, handover_notes: newNotes } : p));
      const { error } = await supabase.from('plots').update({ handover_notes: newNotes }).eq('id', plotId);
      if (error) {
        console.error('Error updating close construction:', error);
        setPlots(prev => prev.map(p => p.id === plotId ? { ...p, handover_notes: oldNotes } : p));
      }
    } catch (err) {
      console.error('Toggle error:', err);
    } finally {
      setUpdatingPlotId(null);
    }
  };

  const handleToggleCloseSales = async (plotId: string, currentVal: boolean) => {
    try {
      setUpdatingPlotId(plotId);
      const targetPlot = plots.find(p => p.id === plotId);
      if (!targetPlot) return;
      const nextVal = !currentVal;
      const oldNotes = targetPlot.handover_notes || '';
      const cleanNotes = oldNotes.replace(/\[close_sales:(done|pending)\]/g, '').trim();
      const newNotes = cleanNotes 
        ? `${cleanNotes} [close_sales:${nextVal ? 'done' : 'pending'}]` 
        : `[close_sales:${nextVal ? 'done' : 'pending'}]`;

      setPlots(prev => prev.map(p => p.id === plotId ? { ...p, handover_notes: newNotes } : p));
      const { error } = await supabase.from('plots').update({ handover_notes: newNotes }).eq('id', plotId);
      if (error) {
        console.error('Error updating close sales:', error);
        setPlots(prev => prev.map(p => p.id === plotId ? { ...p, handover_notes: oldNotes } : p));
      }
    } catch (err) {
      console.error('Toggle error:', err);
    } finally {
      setUpdatingPlotId(null);
    }
  };

  // Process & Assemble Rows
  const rows = useMemo(() => {
    // Map overall progress
    const overallMap = new Map<string, number>();
    plotOverallProgress.forEach(s => overallMap.set(String(s.plot_id), Math.round(Number(s.actual_avg || 0))));

    // Map template IDs to task names
    const templateMap = new Map<string, string>();
    taskTemplates.forEach(t => templateMap.set(String(t.id), t.task_name));

    // Progress lookup by plotId and task keyword
    const plotTaskProg = new Map<string, Record<string, number>>();
    taskAssignments.forEach(a => {
      const tName = templateMap.get(String(a.task_template_id));
      if (tName) {
        if (!plotTaskProg.has(a.plot_id)) plotTaskProg.set(a.plot_id, {});
        plotTaskProg.get(a.plot_id)![tName] = a.current_progress || 0;
      }
    });

    // Helper to get progress by task name keyword
    const getTaskProgress = (plotId: string, keyword: string): number => {
      const tasks = plotTaskProg.get(plotId);
      if (!tasks) return 0;
      let maxProg = 0;
      for (const [name, prog] of Object.entries(tasks)) {
        if (name.includes(keyword) && prog > maxProg) {
          maxProg = prog;
        }
      }
      return maxProg;
    };

    const getTaskDone = (plotId: string, keyword: string): boolean => {
      return getTaskProgress(plotId, keyword) >= 100;
    };

    return plots.map(plot => {
      const sale = sales.find(s => s.plot_id === plot.id && s.contract_status !== 'Cancelled') ||
                   sales.find(s => s.plot_id === plot.id);
      const lead = sale ? leads.find(l => l.id === sale.lead_id) : 
                   leads.find(l => l.interested_plot_id === plot.id || (l.interested_plot_name === plot.plot_name && l.project_name === plot.project_name));

      // Customer name resolution
      const customerName = lead?.customer_name || plot.current_tenant_name || extractCustomerName(plot.highlight_note) || '-';

      // Defects for this plot
      const plotDefects = defects.filter(d => String(d.plot_id) === String(plot.id));
      const hasUnresolvedDefects = plotDefects.some(d => (d.progress || 0) < 100 && d.status !== 'resolved');
      const qcPass = plotDefects.length > 0 ? !hasUnresolvedDefects : (plot.is_completed || false);

      // Promotions (Termite treatment check)
      const plotPromos = promotions.filter(p => String(p.plot_id) === String(plot.id));
      const termitePromo = plotPromos.find(p => 
        (p.item_name && p.item_name.includes('ปลวก')) || 
        (p.category && p.category.includes('ปลวก'))
      );
      const hasTermiteDone = termitePromo ? (termitePromo.status === 'installed' || termitePromo.status === 'delivered') : false;
      const termiteDate = termitePromo?.delivery_date ? formatDateDMY(termitePromo.delivery_date) : '-';

      // Transfer & Completion Dates
      const expectedTransferDate = sale?.expected_transfer_date || lead?.expected_transfer_date || extractExpectedDate(plot.highlight_note) || extractExpectedDate(sale?.notes) || null;
      const actualTransferDate = sale?.transferred_at || sale?.transfer_date || (plot.sale_status === 'Transferred' ? plot.updated_at : null);
      const isTransferred = Boolean(actualTransferDate || plot.sale_status === 'Transferred');

      // Date used for Month-to-Month filtering
      const targetDateStr = actualTransferDate || expectedTransferDate || plot.handover_completed_at || plot.inspection_round1_date;
      let targetYear: number | null = null;
      let targetMonth: number | null = null;

      if (targetDateStr) {
        try {
          const d = new Date(targetDateStr);
          if (!isNaN(d.getTime())) {
            targetYear = d.getFullYear();
            targetMonth = d.getMonth() + 1;
          }
        } catch {
          // ignore
        }
      }

      // Construction progress (% ก่อสร้าง จริงจากระบบงานก่อสร้าง vw_plot_overall_status)
      const progress = overallMap.get(String(plot.id)) ?? (plot.progress ?? 0);

      // การก่อสร้างสิ้นสุด (Auto เมื่อครบ 100% หรือทำเครื่องหมายเสร็จสิ้น + One-click override)
      const manualFinishedTag = Boolean(plot.handover_notes && plot.handover_notes.includes('[construction_finished:done]'));
      const manualPendingTag = Boolean(plot.handover_notes && plot.handover_notes.includes('[construction_finished:pending]'));
      const autoFinished = progress >= 100 || Boolean(plot.is_completed);
      const isConstructionFinished = manualFinishedTag ? true : (manualPendingTag ? false : autoFinished);

      // คาดว่าแล้วเสร็จ: ดึงจากวันที่ในแผนงาน (วันสิ้นสุดของงวดงานก่อสร้างล่าสุดจาก plot_task_assignments)
      const plotAssigns = taskAssignments.filter(a => String(a.plot_id) === String(plot.id));
      const endDates = plotAssigns.map(a => a.actual_end_date).filter(Boolean).sort();
      const latestPlanEndDate = endDates.length > 0 ? endDates[endDates.length - 1] : null;
      const expectedFinishDate = formatDateDMY(latestPlanEndDate);

      // 🛠️ Field Work Checklist Calculations:
      // 1. สุขภัณฑ์
      const sanDone = getTaskDone(plot.id, 'สุขภัณฑ์');

      // 2. ปั๊มน้ำ / ถังเก็บน้ำ
      const pumpDone = getTaskDone(plot.id, 'ปั้มน้ำ') || getTaskDone(plot.id, 'ปั๊มน้ำ') || getTaskDone(plot.id, 'ถังเก็บน้ำ');

      // 3. ดินดำ: ให้นับถ้ามีความคืบหน้าในงานปูหญ้า (>0%) หรือมีงานปรับพื้นที่/ดินดำ
      const grassProg = getTaskProgress(plot.id, 'หญ้า');
      const soilDone = grassProg > 0 || getTaskDone(plot.id, 'ปรับพื้นที่') || getTaskDone(plot.id, 'ดินดำ');

      // 4. หญ้า: เมื่องานปูหญ้าเสร็จสมบูรณ์ 100%
      const grassDone = grassProg >= 100;

      // 5. รั้ว
      const fenceDone = getTaskDone(plot.id, 'รั้ว');

      // 6. ทรายล้าง
      const sandwashDone = getTaskDone(plot.id, 'ทรายล้าง');

      // 7. เคลือบทรายล้าง: ตรวจจาก tag ใน handover_notes หรือคลิกสลับสถานะ
      const hasCoatingDoneTag = Boolean(plot.handover_notes && plot.handover_notes.includes('[sandwash_coating:done]'));
      const hasCoatingPendingTag = Boolean(plot.handover_notes && plot.handover_notes.includes('[sandwash_coating:pending]'));
      const sandwashCoatingDone = hasCoatingDoneTag ? true : (hasCoatingPendingTag ? false : (sandwashDone && progress >= 95));

      // Inspection Statuses
      const round1Status = plot.inspection_round1_status || 'pending';
      const round2Status = plot.inspection_round2_status || 'pending';

      // 8. ปิดจบ ก่อสร้าง:
      // เสร็จงานทุกอย่าง (ความคืบหน้า 100%) + เก็บงานตรวจรับมอบบ้านผ่านทุกรอบ (ไม่มี Defect ค้าง) + มีการกดมอบบ้าน
      const isHandoverDelivered = Boolean(plot.handover_status === 'completed' || plot.handover_completed_at);
      const manualCloseConstruction = Boolean(plot.handover_notes && plot.handover_notes.includes('[close_construction:done]'));
      const manualPendingConstruction = Boolean(plot.handover_notes && plot.handover_notes.includes('[close_construction:pending]'));
      const autoCloseConstruction = Boolean((plot.is_completed || progress >= 100) && !hasUnresolvedDefects && isHandoverDelivered);
      const closeConstruction = manualCloseConstruction ? true : (manualPendingConstruction ? false : autoCloseConstruction);

      // 9. ปิดจบ ฝ่ายขาย:
      // โอนกรรมสิทธิ์แล้ว + รับมอบบ้านแล้ว + มีการรับเฟอร์นิเจอร์ครบ (หรือไม่มีเฟอร์นิเจอร์ให้ผ่านเงื่อนไข)
      const tasks = plotTaskProg.get(plot.id) || {};
      const plotFurnitureTasks = Object.keys(tasks).filter(k => k.includes('เฟอร์นิเจอร์'));
      const hasFurnitureTask = plotFurnitureTasks.length > 0;
      const furnitureTaskDone = hasFurnitureTask ? plotFurnitureTasks.every(k => (tasks[k] || 0) >= 100) : false;

      const furniturePromos = plotPromos.filter(p => 
        (p.item_name && p.item_name.includes('เฟอร์')) || 
        (p.category && p.category.includes('เฟอร์'))
      );
      const hasFurniturePromo = furniturePromos.length > 0;
      const furniturePromoDone = hasFurniturePromo ? furniturePromos.every(p => ['installed', 'delivered', 'completed'].includes(p.status)) : false;

      const hasFurniture = hasFurnitureTask || hasFurniturePromo;
      const furnitureDone = hasFurniture ? (hasFurnitureTask ? furnitureTaskDone : true) && (hasFurniturePromo ? furniturePromoDone : true) : true;
      const furnitureNote = !hasFurniture ? 'ไม่มีเฟอร์นิเจอร์' : (furnitureDone ? 'รับเฟอร์นิเจอร์ครบแล้ว' : 'รอส่งมอบเฟอร์นิเจอร์');

      const manualCloseSales = Boolean(plot.handover_notes && plot.handover_notes.includes('[close_sales:done]'));
      const manualPendingSales = Boolean(plot.handover_notes && plot.handover_notes.includes('[close_sales:pending]'));
      const autoCloseSales = Boolean(isTransferred && isHandoverDelivered && furnitureDone);
      const closeSales = manualCloseSales ? true : (manualPendingSales ? false : autoCloseSales);

      return {
        id: plot.id,
        plotName: plot.plot_name || plot.id,
        projectName: plot.project_name || '-',
        houseModel: plot.house_types?.type_name || plot.house_model || '-',
        imageUrl: plot.overview_image_url || null,
        isRental: isRentalPlot(plot),
        hasCustomer: Boolean(plot.has_customer || sale || lead || customerName !== '-'),
        customerName,
        
        // Month Filter matching info
        targetYear,
        targetMonth,
        hasTransferDate: Boolean(targetDateStr),

        // Core Statuses
        qcPass,
        progress,
        isConstructionFinished,
        expectedFinishDate,
        inspectionDate: formatDateDMY(plot.inspection_round1_date),
        handoverDate: formatDateDMY(plot.handover_completed_at),
        isTransferred,
        transferDate: actualTransferDate ? formatDateDMY(actualTransferDate) : (expectedTransferDate ? `คาด: ${formatDateDMY(expectedTransferDate)}` : '-'),

        // Site Checklist (Green/Red)
        sanDone,
        pumpDone,
        soilDone,
        grassDone,
        fenceDone,
        sandwashDone,
        sandwashCoatingDone,
        round1Status,
        round2Status,
        closeConstruction,
        closeSales,
        furnitureNote,
        hasTermiteDone,
        termiteDate,

        // Admin & Utilities
        permitStatus: plot.permit_status || 'NotStarted',
        permitDate: formatDateDMY(plot.permit_date),
        regStatus: plot.registration_status || 'NotStarted',
        regDate: formatDateDMY(plot.registration_date),
        elecStatus: plot.electric_meter_status || 'NotStarted',
        elecDate: formatDateDMY(plot.electric_meter_installed_date || plot.electric_meter_date),
        waterStatus: plot.water_meter_status || 'NotStarted',
        waterDate: formatDateDMY(plot.water_meter_installed_date || plot.water_meter_date),
      };
    });
  }, [plots, sales, leads, taskAssignments, taskTemplates, defects, promotions, plotOverallProgress]);

  // Filter Rows based on Month-to-Month Range, Project, Search, Status
  const filteredRows = useMemo(() => {
    return rows.filter(row => {
      // 1. Project Filter
      if (selectedProject !== 'all' && row.projectName !== selectedProject) return false;

      // 2. Search Term
      if (searchTerm.trim()) {
        const q = searchTerm.trim().toLowerCase();
        const matchName = row.plotName.toLowerCase().includes(q);
        const matchProj = row.projectName.toLowerCase().includes(q);
        const matchCust = row.customerName.toLowerCase().includes(q);
        if (!matchName && !matchProj && !matchCust) return false;
      }

      // 3. Status Tab Filter
      if (statusFilter === 'rental' && !row.isRental) return false;
      if (statusFilter === 'transferred' && !row.isTransferred) return false;
      if (statusFilter === 'waiting' && (row.isTransferred || row.isRental)) return false;

      // 4. Date Range: Month to Month
      if (!filterAllMonths) {
        if (!row.hasTransferDate) {
          return includeUnscheduled;
        }

        if (row.targetYear && row.targetMonth) {
          const rowVal = row.targetYear * 12 + row.targetMonth;
          const fromVal = fromYear * 12 + fromMonth;
          const toVal = toYear * 12 + toMonth;
          
          if (row.isTransferred) {
            // โอนสำเร็จแล้ว: ต้องอยู่ในช่วงเดือนที่เลือก
            if (rowVal < fromVal || rowVal > toVal) return false;
          } else {
            // บ้านรอโอน: แปลงที่นัดหมายก่อนหน้านี้ถือเป็น "ตกค้างจากเดือนก่อน" (Carried over) ยังคงอยู่ในเป้าหมายรอโอนของเดือนนี้
            // ถ้ากำหนดวันนัดหมายในอนาคตเกินช่วงเดือนที่เลือก ให้ดูว่าติ๊ก includeUnscheduled ไว้หรือไม่
            if (rowVal > toVal) {
              return includeUnscheduled;
            }
          }
        } else {
          return includeUnscheduled;
        }
      }

      return true;
    }).sort((a, b) => {
      // Natural Sort by Project then Plot Name
      const pDiff = a.projectName.localeCompare(b.projectName, 'th', { numeric: true, sensitivity: 'base' });
      if (pDiff !== 0) return pDiff;
      return a.plotName.localeCompare(b.plotName, 'th', { numeric: true, sensitivity: 'base' });
    });
  }, [rows, selectedProject, searchTerm, statusFilter, filterAllMonths, fromMonth, fromYear, toMonth, toYear, includeUnscheduled]);

  // Export to CSV matching Excel
  const exportToCSV = () => {
    const headers = [
      'แปลง', 'โครงการ', 'แบบบ้าน', 'QC pass', '% ก่อสร้าง', 'ก่อสร้างสิ้นสุด', 'มีลูกค้า', 'ลูกค้า',
      'วันนัดตรวจ', 'วันที่รับมอบ', 'โอน', 'วันที่โอน',
      'สุขภัณฑ์', 'ปั๊มน้ำ', 'ดินดำ', 'หญ้า', 'รั้ว', 'ทรายล้าง', 'เคลือบทรายล้าง',
      'ตรวจ 1', 'ตรวจ 2', 'ปิดจบก่อสร้าง', 'ปิดจบฝ่ายขาย', 'ปลวก', 'วันที่ฉีดน้ำยาปลวก',
      'ใบอนุญาตก่อสร้าง', 'วันที่ขออนุญาต', 'ทะเบียนบ้าน', 'วันที่ทะเบียนบ้าน',
      'มิเตอร์ไฟฟ้า', 'วันที่มิเตอร์ไฟ', 'มิเตอร์ประปา', 'วันที่มิเตอร์น้ำ'
    ];

    const csvRows = [headers.join(',')];

    filteredRows.forEach(r => {
      const rowData = [
        `"${r.plotName}"`,
        `"${r.projectName}"`,
        `"${r.houseModel}"`,
        r.qcPass ? 'Pass' : 'Pending',
        `"${r.progress}%"`,
        r.isConstructionFinished ? 'Yes' : 'No',
        r.hasCustomer ? 'Yes' : 'No',
        `"${r.customerName}"`,
        `"${r.inspectionDate}"`,
        `"${r.handoverDate}"`,
        r.isTransferred ? 'โอนแล้ว' : 'รอโอน',
        `"${r.transferDate}"`,
        r.sanDone ? 'Done' : 'Pending',
        r.pumpDone ? 'Done' : 'Pending',
        r.soilDone ? 'Done' : 'Pending',
        r.grassDone ? 'Done' : 'Pending',
        r.fenceDone ? 'Done' : 'Pending',
        r.sandwashDone ? 'Done' : 'Pending',
        r.sandwashCoatingDone ? 'Done' : 'Pending',
        `"${r.round1Status}"`,
        `"${r.round2Status}"`,
        r.closeConstruction ? 'Done' : 'Pending',
        r.closeSales ? 'Done' : 'Pending',
        r.hasTermiteDone ? 'Done' : 'Pending',
        `"${r.termiteDate}"`,
        `"${r.permitStatus}"`,
        `"${r.permitDate}"`,
        `"${r.regStatus}"`,
        `"${r.regDate}"`,
        `"${r.elecStatus}"`,
        `"${r.elecDate}"`,
        `"${r.waterStatus}"`,
        `"${r.waterDate}"`
      ];
      csvRows.push(rowData.join(','));
    });

    const csvContent = '\uFEFF' + csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `BuildTrack_Transfer_Matrix_${fromMonth}_${fromYear}_to_${toMonth}_${toYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="bg-slate-50 min-h-screen p-4 sm:p-6 lg:p-8 space-y-6 animate-fade-in font-sans">
      
      {/* 🧭 Top Bar & Navigation */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-3.5">
          {onBack && (
            <button
              onClick={onBack}
              className="p-2.5 hover:bg-slate-100 rounded-2xl text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
              title="ย้อนกลับ"
            >
              <ArrowLeft size={20} />
            </button>
          )}
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#166534] to-[#15803d] text-white flex items-center justify-center shadow-md shadow-emerald-900/20 shrink-0">
            <FileSpreadsheet size={26} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase text-emerald-800 tracking-wider bg-emerald-50 px-2.5 py-0.5 rounded-md border border-emerald-200">
                Handover & Transfer Readiness
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 mt-0.5 tracking-tight">
              ตารางติดตามบ้านรอโอน (Transfer Tracking Matrix)
            </h1>
            <p className="text-xs text-slate-500 font-medium">
              คัดเฉพาะบ้านรอโอนกรรมสิทธิ์และบ้านเช่า • ตรวจสอบความพร้อมงานก่อสร้าง, เอกสารสิทธิ์, มิเตอร์น้ำไฟ
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 self-end md:self-auto">
          <button
            onClick={() => window.print()}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
            title="พิมพ์หน้านี้"
          >
            <Printer size={15} />
            <span className="hidden sm:inline">พิมพ์ / Print</span>
          </button>
          <button
            onClick={exportToCSV}
            className="px-4 py-2 bg-[#166534] hover:bg-[#14532d] text-white text-xs font-black rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shadow-sm active:scale-95"
            title="ดาวน์โหลดเป็นไฟล์ CSV/Excel"
          >
            <Download size={15} />
            <span>Export Excel</span>
          </button>
          <button
            onClick={fetchAllMatrixData}
            disabled={loading}
            className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
            title="รีเฟรชข้อมูล"
          >
            <RefreshCw size={17} className={loading ? 'animate-spin text-emerald-600' : ''} />
          </button>
        </div>
      </div>

      {/* 📅 Excel-Style Month Filter Bar */}
      <div className="bg-[#14532d] text-white p-4 sm:p-5 rounded-3xl shadow-lg border border-emerald-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          
          {/* Month Range Selectors (Matching User's Excel Screenshot) */}
          <div className="flex flex-wrap items-center gap-3">
            
            {/* From Month */}
            <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-3 py-1.5 rounded-2xl border border-white/20">
              <span className="text-xs font-black text-emerald-200">เดือน:</span>
              <select
                value={fromMonth}
                onChange={(e) => setFromMonth(Number(e.target.value))}
                disabled={filterAllMonths}
                className="bg-transparent text-white font-extrabold text-xs outline-none cursor-pointer disabled:opacity-50"
              >
                {THAI_MONTHS.map(m => (
                  <option key={m.value} value={m.value} className="text-slate-900 bg-white font-bold">
                    {m.name}
                  </option>
                ))}
              </select>
              <select
                value={fromYear}
                onChange={(e) => setFromYear(Number(e.target.value))}
                disabled={filterAllMonths}
                className="bg-transparent text-white font-extrabold text-xs outline-none cursor-pointer disabled:opacity-50"
              >
                {YEARS.map(y => (
                  <option key={y} value={y} className="text-slate-900 bg-white font-bold">
                    {y} ({y + 543})
                  </option>
                ))}
              </select>
            </div>

            <span className="text-xs font-black text-emerald-300">ถึงเดือน:</span>

            {/* To Month */}
            <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-3 py-1.5 rounded-2xl border border-white/20">
              <select
                value={toMonth}
                onChange={(e) => setToMonth(Number(e.target.value))}
                disabled={filterAllMonths}
                className="bg-transparent text-white font-extrabold text-xs outline-none cursor-pointer disabled:opacity-50"
              >
                {THAI_MONTHS.map(m => (
                  <option key={m.value} value={m.value} className="text-slate-900 bg-white font-bold">
                    {m.name}
                  </option>
                ))}
              </select>
              <select
                value={toYear}
                onChange={(e) => setToYear(Number(e.target.value))}
                disabled={filterAllMonths}
                className="bg-transparent text-white font-extrabold text-xs outline-none cursor-pointer disabled:opacity-50"
              >
                {YEARS.map(y => (
                  <option key={y} value={y} className="text-slate-900 bg-white font-bold">
                    {y} ({y + 543})
                  </option>
                ))}
              </select>
            </div>

            {/* Checkbox All Months */}
            <label className="flex items-center gap-2 text-xs font-bold text-emerald-100 cursor-pointer bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-xl border border-white/10 transition-colors">
              <input
                type="checkbox"
                checked={filterAllMonths}
                onChange={(e) => setFilterAllMonths(e.target.checked)}
                className="rounded accent-emerald-500 cursor-pointer"
              />
              <span>ดูทุกเดือน (All)</span>
            </label>

            {/* Include Unscheduled Checkbox */}
            {!filterAllMonths && (
              <label className="flex items-center gap-2 text-xs font-bold text-emerald-100 cursor-pointer bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-xl border border-white/10 transition-colors">
                <input
                  type="checkbox"
                  checked={includeUnscheduled}
                  onChange={(e) => setIncludeUnscheduled(e.target.checked)}
                  className="rounded accent-emerald-500 cursor-pointer"
                />
                <span>รวมแปลงรอโอนยังไม่ระบุวัน</span>
              </label>
            )}
          </div>

          {/* Quick Counter */}
          <div className="flex items-center gap-2 bg-emerald-950/60 border border-emerald-700/60 px-3.5 py-1.5 rounded-2xl">
            <span className="text-[11px] text-emerald-300 font-bold">แปลงที่แสดง:</span>
            <span className="text-sm font-black text-white">{filteredRows.length} แปลง</span>
          </div>
        </div>

        {/* Secondary Filter Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-emerald-700/60">
          
          {/* Quick Status Tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-emerald-950/70 rounded-xl">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1 rounded-lg text-xs font-extrabold transition-all cursor-pointer ${
                statusFilter === 'all' ? 'bg-white text-emerald-950 shadow-xs' : 'text-emerald-200 hover:text-white'
              }`}
            >
              📌 ทั้งหมด ({rows.length})
            </button>
            <button
              onClick={() => setStatusFilter('waiting')}
              className={`px-3 py-1 rounded-lg text-xs font-extrabold transition-all cursor-pointer ${
                statusFilter === 'waiting' ? 'bg-emerald-500 text-white shadow-xs' : 'text-emerald-200 hover:text-white'
              }`}
            >
              🔑 รอโอนกรรมสิทธิ์ ({rows.filter(r => !r.isTransferred && !r.isRental).length})
            </button>
            <button
              onClick={() => setStatusFilter('transferred')}
              className={`px-3 py-1 rounded-lg text-xs font-extrabold transition-all cursor-pointer ${
                statusFilter === 'transferred' ? 'bg-emerald-500 text-white shadow-xs' : 'text-emerald-200 hover:text-white'
              }`}
            >
              🟢 โอนสำเร็จแล้ว ({rows.filter(r => r.isTransferred).length})
            </button>
            <button
              onClick={() => setStatusFilter('rental')}
              className={`px-3 py-1 rounded-lg text-xs font-extrabold transition-all cursor-pointer ${
                statusFilter === 'rental' ? 'bg-teal-500 text-white shadow-xs' : 'text-emerald-200 hover:text-white'
              }`}
            >
              🏷️ บ้านเช่า ({rows.filter(r => r.isRental).length})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Project Filter */}
            <div className="flex items-center gap-1.5 bg-white/10 px-3 py-1.5 rounded-xl border border-white/20">
              <Building2 size={14} className="text-emerald-200" />
              <select
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                className="bg-transparent text-white font-bold text-xs outline-none cursor-pointer"
              >
                <option value="all" className="text-slate-900 bg-white font-bold">ทุกโครงการ (All Projects)</option>
                {projects.filter(p => !p.is_closed).map(p => (
                  <option key={p.id} value={p.name} className="text-slate-900 bg-white font-bold">
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Search Box */}
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-emerald-300" />
              <input
                type="text"
                placeholder="ค้นหาแปลง (เช่น AL6-06)..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-white/10 text-white placeholder-emerald-300/70 text-xs font-bold pl-8 pr-3 py-1.5 rounded-xl border border-white/20 outline-none focus:ring-2 focus:ring-emerald-400 w-44 sm:w-56"
              />
            </div>
          </div>

        </div>
      </div>

      {/* 🟢 Legend Bar */}
      <div className="flex flex-wrap items-center gap-4 text-xs font-bold text-slate-600 bg-white p-3 rounded-2xl border border-slate-200/80 shadow-2xs">
        <span className="text-slate-400 font-extrabold flex items-center gap-1">
          <Filter size={13} /> สัญลักษณ์:
        </span>
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-md bg-[#16a34a] text-white flex items-center justify-center text-[10px] font-black">✓</span>
          <span>สีเขียว = ผ่านแล้ว / เรียบร้อย 100%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-md bg-[#dc2626] text-white flex items-center justify-center text-[10px] font-black">!</span>
          <span>สีแดง = มีงานค้าง / งานแก้ / ยังไม่เสร็จ</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-md bg-slate-100 border border-slate-300 text-slate-400 flex items-center justify-center text-[10px]">-</span>
          <span>สีเทา = ยังไม่ดำเนินการ / ไม่มีรายการ</span>
        </div>
      </div>

      {/* 📊 Matrix Table (Excel Spreadsheet Layout) */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-md overflow-hidden">
        <div className="overflow-x-auto max-h-[75vh] custom-scrollbar relative">
          <table className="w-full border-collapse text-xs text-center">
            
            {/* Header (Excel Dark Forest Green) */}
            <thead className="sticky top-0 z-30 bg-[#16532d] text-white font-black uppercase tracking-wider text-[11px] shadow-sm">
              <tr>
                {/* 📌 Sticky Left Column: Plot Info & Image */}
                <th className="sticky left-0 z-40 bg-[#14532d] py-3.5 px-3 min-w-[200px] text-left border-r border-emerald-700 shadow-[4px_0_12px_rgba(0,0,0,0.15)]">
                  แปลง (Plot & Picture)
                </th>
                <th className="py-3 px-2 min-w-[70px] border-r border-emerald-700/80">QC pass</th>
                <th className="py-3 px-2 min-w-[95px] border-r border-emerald-700/80">% ก่อสร้าง</th>
                <th className="py-3 px-2 min-w-[85px] border-r border-emerald-700/80">ก่อสร้างสิ้นสุด</th>
                <th className="py-3 px-2 min-w-[95px] border-r border-emerald-700/80">คาดว่าแล้วเสร็จ</th>
                <th className="py-3 px-2 min-w-[75px] border-r border-emerald-700/80">มีลูกค้า</th>
                <th className="py-3 px-2 min-w-[95px] border-r border-emerald-700/80">วันนัดตรวจ</th>
                <th className="py-3 px-2 min-w-[95px] border-r border-emerald-700/80">วันที่รับมอบ</th>
                <th className="py-3 px-2 min-w-[80px] border-r border-emerald-700/80">โอน</th>
                <th className="py-3 px-2 min-w-[100px] border-r border-emerald-700/80">วันที่โอน</th>

                {/* 🛠️ Field Work Checklist */}
                <th className="py-3 px-2 min-w-[75px] border-r border-emerald-700/80">สุขภัณฑ์</th>
                <th className="py-3 px-2 min-w-[75px] border-r border-emerald-700/80">ปั๊มน้ำ</th>
                <th className="py-3 px-2 min-w-[75px] border-r border-emerald-700/80">ดินดำ</th>
                <th className="py-3 px-2 min-w-[75px] border-r border-emerald-700/80">หญ้า</th>
                <th className="py-3 px-2 min-w-[75px] border-r border-emerald-700/80">รั้ว</th>
                <th className="py-3 px-2 min-w-[75px] border-r border-emerald-700/80">ทรายล้าง</th>
                <th className="py-3 px-2 min-w-[95px] border-r border-emerald-700/80">เคลือบทรายล้าง</th>
                <th className="py-3 px-2 min-w-[80px] border-r border-emerald-700/80">ตรวจ 1</th>
                <th className="py-3 px-2 min-w-[80px] border-r border-emerald-700/80">ตรวจ 2</th>
                <th className="py-3 px-2 min-w-[95px] border-r border-emerald-700/80">ปิดจบ ก่อสร้าง</th>
                <th className="py-3 px-2 min-w-[95px] border-r border-emerald-700/80">ปิดจบ ฝ่ายขาย</th>
                <th className="py-3 px-2 min-w-[70px] border-r border-emerald-700/80">ปลวก</th>
                <th className="py-3 px-2 min-w-[110px] border-r border-emerald-700/80">วันที่ฉีดปลวก</th>

                {/* 📑 Documents & Utilities */}
                <th className="py-3 px-2 min-w-[100px] border-r border-emerald-700/80">ใบอนุญาตก่อสร้าง</th>
                <th className="py-3 px-2 min-w-[100px] border-r border-emerald-700/80">วันที่ขออนุญาต</th>
                <th className="py-3 px-2 min-w-[90px] border-r border-emerald-700/80">ทะเบียนบ้าน</th>
                <th className="py-3 px-2 min-w-[100px] border-r border-emerald-700/80">วันที่ทะเบียนบ้าน</th>
                <th className="py-3 px-2 min-w-[90px] border-r border-emerald-700/80">มิเตอร์ไฟฟ้า</th>
                <th className="py-3 px-2 min-w-[100px] border-r border-emerald-700/80">วันที่มิเตอร์ไฟ</th>
                <th className="py-3 px-2 min-w-[90px] border-r border-emerald-700/80">มิเตอร์ประปา</th>
                <th className="py-3 px-2 min-w-[100px]">วันที่มิเตอร์น้ำ</th>
              </tr>
            </thead>

            {/* Table Body */}
            <tbody className="divide-y divide-slate-200 font-semibold text-slate-800">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={31} className="py-16 text-center text-slate-400">
                    <FileSpreadsheet size={40} className="mx-auto text-slate-300 mb-2" />
                    <p className="font-bold text-base text-slate-600">ไม่พบแปลงรอโอนในเดือนที่เลือก</p>
                    <p className="text-xs text-slate-400 mt-1">ลองเปลี่ยนช่วงเดือน หรือติ๊ก &quot;ดูทุกเดือน (All)&quot; เพื่อแสดงข้อมูลบ้านรอโอนทั้งหมด</p>
                  </td>
                </tr>
              ) : (
                filteredRows.map((r, idx) => {
                  const isEven = idx % 2 === 0;

                  return (
                    <tr key={r.id} className={`group transition-colors ${isEven ? 'bg-white' : 'bg-slate-50'} hover:bg-emerald-50/60`}>
                      
                      {/* 📌 Sticky Left Column: Thumbnail + Plot Name (100% Solid Opaque Background) */}
                      <td className={`sticky left-0 z-20 py-2.5 px-3 border-r border-slate-200 text-left shadow-[4px_0_12px_rgba(0,0,0,0.08)] transition-colors ${isEven ? 'bg-white' : 'bg-slate-50'} group-hover:bg-[#ecfdf5]`}>
                        <div className="flex items-center gap-2.5">
                          {/* Thumbnail */}
                          {r.imageUrl ? (
                            <img
                              src={r.imageUrl}
                              alt={r.plotName}
                              onClick={() => setPreviewImage(r.imageUrl)}
                              className="w-12 h-12 rounded-xl object-cover border border-slate-200 shadow-2xs shrink-0 cursor-zoom-in hover:scale-105 transition-transform"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 shrink-0">
                              <Home size={18} />
                            </div>
                          )}

                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span 
                                onClick={() => onViewPlot?.(r)}
                                className="font-black text-sm text-slate-900 hover:text-emerald-700 cursor-pointer truncate"
                              >
                                {r.plotName}
                              </span>
                              {r.isRental && (
                                <span className="text-[9px] font-black text-teal-700 bg-teal-100 border border-teal-200 px-1 py-0.2 rounded">
                                  เช่า
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-slate-500 font-bold block truncate">
                              {r.projectName} • {r.houseModel}
                            </span>
                            {r.customerName !== '-' && (
                              <span className="text-[10px] text-emerald-800 font-bold block truncate">
                                👤 {r.customerName}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* QC Pass */}
                      <td className="py-2.5 px-2 border-r border-slate-200">
                        {r.qcPass ? (
                          <span className="inline-block bg-[#16a34a] text-white p-1 rounded-md" title="QC Pass">
                            <Check size={14} strokeWidth={3} />
                          </span>
                        ) : (
                          <span className="inline-block bg-[#dc2626] text-white p-1 rounded-md" title="มีงานแก้ / ยังไม่ผ่าน">
                            <X size={14} strokeWidth={3} />
                          </span>
                        )}
                      </td>

                      {/* % ก่อสร้าง */}
                      <td className="py-2.5 px-2 border-r border-slate-200 font-bold">
                        <span className={`px-2 py-0.5 rounded-md ${r.progress >= 100 ? 'bg-emerald-100 text-emerald-800 font-black' : 'text-slate-700'}`}>
                          {r.progress}%
                        </span>
                      </td>

                      {/* การก่อสร้างสิ้นสุด (Auto เมื่อ 100% หรือเสร็จสิ้น + One-click toggle override) */}
                      <td 
                        onClick={() => handleToggleConstructionFinished(r.id, r.isConstructionFinished)}
                        title="คลิกเพื่อสลับสถานะ: ก่อสร้างสิ้นสุด [✓] / ยังไม่สิ้นสุด [-]"
                        className="py-2.5 px-2 border-r border-slate-200 cursor-pointer select-none transition-all hover:bg-slate-100/70"
                      >
                        {r.isConstructionFinished ? (
                          <span className="inline-block bg-[#16a34a] text-white p-1 rounded-md" title="ก่อสร้างเสร็จสิ้นแล้ว">
                            <Check size={14} strokeWidth={3} />
                          </span>
                        ) : (
                          <span className="text-slate-300 font-bold hover:text-slate-500">-</span>
                        )}
                      </td>

                      {/* คาดว่าแล้วเสร็จ */}
                      <td className="py-2.5 px-2 border-r border-slate-200 text-slate-600 text-[11px]">
                        {r.expectedFinishDate}
                      </td>

                      {/* มีลูกค้า */}
                      <td className="py-2.5 px-2 border-r border-slate-200">
                        {r.hasCustomer ? (
                          <span className="inline-block bg-[#16a34a] text-white p-1 rounded-md" title={`ลูกค้า: ${r.customerName}`}>
                            <Check size={14} strokeWidth={3} />
                          </span>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>

                      {/* วันนัดตรวจ */}
                      <td className="py-2.5 px-2 border-r border-slate-200 text-slate-700 text-[11px] font-bold">
                        {r.inspectionDate}
                      </td>

                      {/* วันที่รับมอบ */}
                      <td className="py-2.5 px-2 border-r border-slate-200 text-slate-700 text-[11px] font-bold">
                        {r.handoverDate}
                      </td>

                      {/* โอน */}
                      <td className="py-2.5 px-2 border-r border-slate-200">
                        {r.isTransferred ? (
                          <span className="bg-emerald-100 text-emerald-800 font-black px-2 py-0.5 rounded border border-emerald-300 text-[10px]">
                            โอนแล้ว
                          </span>
                        ) : (
                          <span className="bg-amber-100 text-amber-800 font-black px-2 py-0.5 rounded border border-amber-300 text-[10px]">
                            รอโอน
                          </span>
                        )}
                      </td>

                      {/* วันที่โอน */}
                      <td className="py-2.5 px-2 border-r border-slate-200 text-[11px] font-bold text-slate-700">
                        {r.transferDate}
                      </td>

                      {/* 🛠️ Field Work Checklist (Green/Red Cells) */}
                      {/* สุขภัณฑ์ */}
                      <td className={`py-2.5 px-2 border-r border-slate-200 ${r.sanDone ? 'bg-[#22c55e] text-white' : 'bg-[#ef4444] text-white'}`}>
                        {r.sanDone ? 'เรียบร้อย' : 'รอดำเนินการ'}
                      </td>

                      {/* ปั๊มน้ำ */}
                      <td className={`py-2.5 px-2 border-r border-slate-200 ${r.pumpDone ? 'bg-[#22c55e] text-white' : 'bg-[#ef4444] text-white'}`}>
                        {r.pumpDone ? 'เรียบร้อย' : 'รอดำเนินการ'}
                      </td>

                      {/* ดินดำ */}
                      <td className={`py-2.5 px-2 border-r border-slate-200 ${r.soilDone ? 'bg-[#22c55e] text-white' : 'bg-[#ef4444] text-white'}`}>
                        {r.soilDone ? 'เรียบร้อย' : 'รอดำเนินการ'}
                      </td>

                      {/* หญ้า */}
                      <td className={`py-2.5 px-2 border-r border-slate-200 ${r.grassDone ? 'bg-[#22c55e] text-white' : 'bg-[#ef4444] text-white'}`}>
                        {r.grassDone ? 'เรียบร้อย' : 'รอดำเนินการ'}
                      </td>

                      {/* รั้ว */}
                      <td className={`py-2.5 px-2 border-r border-slate-200 ${r.fenceDone ? 'bg-[#22c55e] text-white' : 'bg-[#ef4444] text-white'}`}>
                        {r.fenceDone ? 'เรียบร้อย' : 'รอดำเนินการ'}
                      </td>

                      {/* ทรายล้าง */}
                      <td className={`py-2.5 px-2 border-r border-slate-200 ${r.sandwashDone ? 'bg-[#22c55e] text-white' : 'bg-[#ef4444] text-white'}`}>
                        {r.sandwashDone ? 'เรียบร้อย' : 'รอดำเนินการ'}
                      </td>

                      {/* เคลือบทรายล้าง (One-click toggle) */}
                      <td 
                        onClick={() => handleToggleSandwashCoating(r.id, r.sandwashCoatingDone)}
                        title="คลิกเพื่อสลับสถานะ: เคลือบแล้ว / ยังไม่เคลือบ"
                        className={`py-2.5 px-2 border-r border-slate-200 cursor-pointer select-none transition-all hover:brightness-110 active:scale-95 ${
                          r.sandwashCoatingDone ? 'bg-[#22c55e] text-white hover:bg-emerald-600' : 'bg-[#ef4444] text-white hover:bg-rose-600'
                        }`}
                      >
                        <div className="flex items-center justify-center gap-1 font-bold text-xs">
                          {updatingPlotId === r.id ? (
                            <span className="text-[10px] animate-pulse">กำลังบันทึก...</span>
                          ) : (
                            <>
                              <span>{r.sandwashCoatingDone ? 'เคลือบแล้ว' : 'ยังไม่เคลือบ'}</span>
                              <span className="text-[9px] opacity-70">✎</span>
                            </>
                          )}
                        </div>
                      </td>

                      {/* ตรวจ 1 */}
                      <td className={`py-2.5 px-2 border-r border-slate-200 ${
                        r.round1Status === 'passed' ? 'bg-[#22c55e] text-white' :
                        r.round1Status === 'failed' ? 'bg-[#ef4444] text-white' :
                        r.round1Status === 'scheduled' ? 'bg-amber-100 text-amber-900 font-bold' :
                        'text-slate-400'
                      }`}>
                        {r.round1Status === 'passed' ? 'ผ่านแล้ว' :
                         r.round1Status === 'failed' ? 'มีงานแก้' :
                         r.round1Status === 'scheduled' ? 'นัดแล้ว' : 'รอตรวจ'}
                      </td>

                      {/* ตรวจ 2 */}
                      <td className={`py-2.5 px-2 border-r border-slate-200 ${
                        r.round2Status === 'passed' ? 'bg-[#22c55e] text-white' :
                        r.round2Status === 'failed' ? 'bg-[#ef4444] text-white' :
                        r.round2Status === 'scheduled' ? 'bg-amber-100 text-amber-900 font-bold' :
                        'text-slate-400'
                      }`}>
                        {r.round2Status === 'passed' ? 'ผ่านแล้ว' :
                         r.round2Status === 'failed' ? 'มีงานแก้' :
                         r.round2Status === 'scheduled' ? 'นัดแล้ว' : '-'}
                      </td>

                      {/* ปิดจบ ก่อสร้าง (Auto + One-click toggle override) */}
                      <td 
                        onClick={() => handleToggleCloseConstruction(r.id, r.closeConstruction)}
                        title="คลิกเพื่อสลับสถานะ (ระบบนับ: งานเสร็จ 100% + ผ่านตรวจทุกรอบ + มอบบ้าน)"
                        className={`py-2.5 px-2 border-r border-slate-200 cursor-pointer select-none transition-all hover:brightness-110 active:scale-95 ${
                          r.closeConstruction ? 'bg-[#22c55e] text-white hover:bg-emerald-600' : 'bg-[#ef4444] text-white hover:bg-rose-600'
                        }`}
                      >
                        <div className="flex items-center justify-center gap-1 font-bold text-xs">
                          <span>{r.closeConstruction ? 'ปิดจบแล้ว' : 'ยังไม่ปิดจบ'}</span>
                          <span className="text-[9px] opacity-70">✎</span>
                        </div>
                      </td>

                      {/* ปิดจบ ฝ่ายขาย (Auto + One-click toggle override) */}
                      <td 
                        onClick={() => handleToggleCloseSales(r.id, r.closeSales)}
                        title={`คลิกเพื่อสลับสถานะ (ระบบนับ: โอนกรรมสิทธิ์ + มอบบ้าน + ${r.furnitureNote})`}
                        className={`py-2.5 px-2 border-r border-slate-200 cursor-pointer select-none transition-all hover:brightness-110 active:scale-95 ${
                          r.closeSales ? 'bg-[#22c55e] text-white hover:bg-emerald-600' : 'bg-[#ef4444] text-white hover:bg-rose-600'
                        }`}
                      >
                        <div className="flex items-center justify-center gap-1 font-bold text-xs">
                          <span>{r.closeSales ? 'ปิดจบแล้ว' : (r.isTransferred ? 'รอส่งมอบ' : 'ยังไม่ปิดจบ')}</span>
                          <span className="text-[9px] opacity-70">✎</span>
                        </div>
                      </td>

                      {/* ปลวก */}
                      <td className={`py-2.5 px-2 border-r border-slate-200 ${r.hasTermiteDone ? 'bg-[#22c55e] text-white' : 'bg-slate-100 text-slate-400'}`}>
                        {r.hasTermiteDone ? 'ฉีดแล้ว' : '-'}
                      </td>

                      {/* วันที่ฉีดปลวก */}
                      <td className="py-2.5 px-2 border-r border-slate-200 text-[11px] font-bold text-slate-600">
                        {r.termiteDate}
                      </td>

                      {/* 📑 Documents & Utilities */}
                      {/* ใบอนุญาตก่อสร้าง */}
                      <td className="py-2.5 px-2 border-r border-slate-200">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                          r.permitStatus === 'Received' ? 'bg-emerald-100 text-emerald-800' :
                          r.permitStatus === 'Submitting' || r.permitStatus === 'Waiting' ? 'bg-amber-100 text-amber-800' :
                          'bg-slate-100 text-slate-500'
                        }`}>
                          {r.permitStatus === 'Received' ? 'ได้รับแล้ว' : r.permitStatus === 'Waiting' ? 'รอผล' : 'ยังไม่ได้ยื่น'}
                        </span>
                      </td>

                      {/* วันที่ขออนุญาต */}
                      <td className="py-2.5 px-2 border-r border-slate-200 text-[11px] text-slate-600">
                        {r.permitDate}
                      </td>

                      {/* ทะเบียนบ้าน */}
                      <td className="py-2.5 px-2 border-r border-slate-200">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                          r.regStatus === 'Received' ? 'bg-emerald-100 text-emerald-800' :
                          r.regStatus === 'Submitting' || r.regStatus === 'Waiting' ? 'bg-amber-100 text-amber-800' :
                          'bg-slate-100 text-slate-500'
                        }`}>
                          {r.regStatus === 'Received' ? 'ได้รับแล้ว' : r.regStatus === 'Waiting' ? 'รอผล' : 'ยังไม่ได้ยื่น'}
                        </span>
                      </td>

                      {/* วันที่ทะเบียนบ้าน */}
                      <td className="py-2.5 px-2 border-r border-slate-200 text-[11px] text-slate-600">
                        {r.regDate}
                      </td>

                      {/* มิเตอร์ไฟฟ้า */}
                      <td className="py-2.5 px-2 border-r border-slate-200">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                          r.elecStatus === 'Installed' || r.elecStatus === 'Received' ? 'bg-emerald-100 text-emerald-800' :
                          r.elecStatus === 'Paid' ? 'bg-amber-100 text-amber-900 font-bold' :
                          'bg-slate-100 text-slate-500'
                        }`}>
                          {r.elecStatus === 'Installed' || r.elecStatus === 'Received' ? 'ติดตั้งแล้ว' : r.elecStatus === 'Paid' ? 'ชำระแล้ว' : 'ยังไม่ได้ยื่น'}
                        </span>
                      </td>

                      {/* วันที่มิเตอร์ไฟ */}
                      <td className="py-2.5 px-2 border-r border-slate-200 text-[11px] text-slate-600">
                        {r.elecDate}
                      </td>

                      {/* มิเตอร์ประปา */}
                      <td className="py-2.5 px-2 border-r border-slate-200">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                          r.waterStatus === 'Installed' || r.waterStatus === 'Received' ? 'bg-emerald-100 text-emerald-800' :
                          r.waterStatus === 'Paid' ? 'bg-amber-100 text-amber-900 font-bold' :
                          'bg-slate-100 text-slate-500'
                        }`}>
                          {r.waterStatus === 'Installed' || r.waterStatus === 'Received' ? 'ติดตั้งแล้ว' : r.waterStatus === 'Paid' ? 'ชำระแล้ว' : 'ยังไม่ได้ยื่น'}
                        </span>
                      </td>

                      {/* วันที่มิเตอร์น้ำ */}
                      <td className="py-2.5 px-2 text-[11px] text-slate-600">
                        {r.waterDate}
                      </td>

                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 🖼️ Image Lightbox Preview Modal */}
      {previewImage && (
        <SalesOverlay className="fixed inset-0 bg-black/85 z-[400] flex items-center justify-center p-4" onClick={() => setPreviewImage(null)}>
          <div className="relative max-w-4xl max-h-[90vh]">
            <img src={previewImage} alt="Preview" className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl object-contain" />
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute -top-3.5 -right-3.5 bg-white text-slate-900 rounded-full p-2 shadow-xl hover:bg-slate-200 cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </SalesOverlay>
      )}

    </div>
  );
}

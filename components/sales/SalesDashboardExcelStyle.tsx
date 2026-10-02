"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, Calendar, TrendingUp, Users, BarChart, ChevronDown, ChevronUp, Search, Building2 } from 'lucide-react';
import WaitingForTransferDetails from './WaitingForTransferDetails';
import { ComposedChart, Bar, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, LabelList } from 'recharts';

export default function SalesDashboardExcelStyle({ project, onViewDefects }: { project?: any; onViewDefects?: (plot: any) => void }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>({ plots: [], sales: [], fallbackSales: [], leads: [], projects: [], houseTypes: [], evidence: [] });
  
  const [selectedDateStr, setSelectedDateStr] = useState<string>(new Date().toISOString().split('T')[0]);
  const [userSelectedDate, setUserSelectedDate] = useState(false);
  const selectedYear = selectedDateStr.split('-')[0];
  const selectedMonth = selectedDateStr.split('-')[1];

  const [cumulativeYear, setCumulativeYear] = useState<string>(selectedYear);
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string | null>(project?.name || null);
  const [customerSearch, setCustomerSearch] = useState<string>('');

  useEffect(() => {
    setCumulativeYear(selectedYear);
  }, [selectedYear]);

  useEffect(() => {
    if (project?.name) setSelectedProjectFilter(project.name);
  }, [project]);

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [showTotalBreakdown, setShowTotalBreakdown] = useState(false);

  const toggleProjectExpand = (proj: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(proj)) next.delete(proj);
      else next.add(proj);
      return next;
    });
  };

  // Format currency
  const fmtM = (val: number) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);

  useEffect(() => {
    let isMounted = true;
    const fetchAllData = async () => {
      setLoading(true);
      try {
        const { data: pData } = await supabase.from('plots').select('*, house_types(type_name, is_infrastructure)');
        const { data: hTypeData } = await supabase.from('house_types').select('*');
        const { data: projList } = await supabase.from('projects').select('name, is_closed').order('name');
        
        let allSalesRows: any[] = [];
        const projectNames = (projList || []).map((p: any) => p.name).filter((n: string) => n && n !== 'ลูกค้าทั่วไป');

        // Parallel fetch of sales across all projects via crm_v2_project_sales RPC
        const salesPromises = projectNames.map(async (name: string) => {
          const rows: any[] = [];
          let page = 0;
          let hasMore = true;
          while (hasMore && page < 5) {
            const { data: res, error } = await supabase.rpc('crm_v2_project_sales', {
              p_project_name: name,
              p_tab: 'all',
              p_query: '',
              p_page: page
            });
            if (error) break;
            if (res?.rows) rows.push(...res.rows);
            hasMore = Boolean(res?.hasMore);
            page++;
          }
          return rows;
        });

        // Parallel fetch of visit and booking evidence via crm_v2_excel_evidence & booking amounts
        const evidencePromises = projectNames.map(async (name: string) => {
          try {
            const [{ data: ev }, { data: amounts }] = await Promise.all([
              supabase.rpc('crm_v2_excel_evidence', { p_project_name: name }),
              supabase.rpc('crm_v2_excel_booking_amounts', { p_project_name: name })
            ]);
            if (!ev) return null;
            return { projectName: name, ...ev, bookingAmounts: amounts?.rows || [] };
          } catch {
            return null;
          }
        });

        const [rpcResults, evidenceResults] = await Promise.all([
          Promise.all(salesPromises),
          Promise.all(evidencePromises)
        ]);
        allSalesRows = rpcResults.flat();
        const allEvidence = evidenceResults.filter(Boolean);

        // Fallback: If RPC returned 0 rows (e.g. unauthenticated or role missing), query sales table directly
        let fallbackSales: any[] = [];
        if (allSalesRows.length === 0) {
          const { data: directSales } = await supabase.from('sales').select('*');
          if (directSales) fallbackSales = directSales;
        }

        const { data: lData } = await supabase.from('leads').select('*');

        if (isMounted) {
          setData({
            plots: pData || [],
            sales: allSalesRows,
            fallbackSales: fallbackSales,
            leads: lData || [],
            projects: projList || [],
            houseTypes: hTypeData || [],
            evidence: allEvidence
          });

          // If user hasn't picked a date, and current month has 0 transactions/visits,
          // default to the latest date that has activity so they see active monthly figures immediately!
          if (!userSelectedDate) {
            let latestDate: string | null = null;
            allSalesRows.forEach((s: any) => {
              const d = s.bookedAt?.split('T')[0] || s.transferredAt?.split('T')[0] || s.importedHistory?.bookedDate;
              if (d && (!latestDate || d > latestDate)) latestDate = d;
            });
            allEvidence.forEach((ev: any) => {
              (ev.legacyVisits || []).concat(ev.completedVisits || []).forEach((v: any) => {
                if (v.visitDate && (!latestDate || v.visitDate > latestDate)) latestDate = v.visitDate;
              });
            });

            if (latestDate) {
              const currentPrefix = new Date().toISOString().slice(0, 7);
              const hasCurrentMonthActivity = allSalesRows.some((s: any) => {
                const d = s.bookedAt?.split('T')[0] || s.transferredAt?.split('T')[0] || s.importedHistory?.bookedDate;
                return d?.startsWith(currentPrefix);
              }) || allEvidence.some((ev: any) => {
                return (ev.legacyVisits || []).concat(ev.completedVisits || []).some((v: any) => v.visitDate?.startsWith(currentPrefix));
              });

              if (!hasCurrentMonthActivity) {
                setSelectedDateStr(latestDate);
              }
            }
          }
        }

      } catch (err) {
        console.error("Dashboard error:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchAllData();
    return () => { isMounted = false; };
  }, [project]);

  const metrics = useMemo(() => {
    if (!data.plots.length) return null;

    const targetDate = new Date(selectedDateStr);
    const targetMonthPrefix = `${selectedYear}-${selectedMonth.padStart(2, '0')}`;
    const activeProjectName = selectedProjectFilter || project?.name || null;

    // Filter plots by project if specified
    const activePlots = activeProjectName 
      ? data.plots.filter((p: any) => p.project_name === activeProjectName)
      : data.plots;

    // Build unified visits, lead dates, and appraisal amounts from CRM V2 evidence
    const visitMap = new Map<string, { key: string; customerId?: string; visitDate: string; projectName: string | null }>();
    const leadDates = new Map<string, string>();
    const tdPriceMap = new Map<string, number>();

    (data.evidence || []).forEach((ev: any) => {
      const projName = ev.projectName;
      (ev.legacyVisits || []).forEach((v: any) => {
        const k = `legacy:${v.key}`;
        if (!visitMap.has(k)) visitMap.set(k, { key: k, customerId: v.customerId, visitDate: v.visitDate, projectName: projName });
        if (v.customerId && v.leadDate) {
          const prior = leadDates.get(v.customerId);
          if (!prior || v.leadDate < prior) leadDates.set(v.customerId, v.leadDate);
        }
      });
      (ev.completedVisits || []).forEach((v: any) => {
        const k = `live:${v.key}`;
        if (!visitMap.has(k)) visitMap.set(k, { key: k, customerId: v.customerId, visitDate: v.visitDate, projectName: projName });
        if (v.customerId && v.visitDate) {
          const prior = leadDates.get(v.customerId);
          if (!prior || v.visitDate < prior) leadDates.set(v.customerId, v.visitDate);
        }
      });
      (ev.unassignedLegacyVisits || []).forEach((v: any) => {
        const k = `unassigned:${v.key}`;
        if (!visitMap.has(k)) visitMap.set(k, { key: k, customerId: v.customerId, visitDate: v.visitDate, projectName: null });
        if (v.customerId && v.leadDate) {
          const prior = leadDates.get(v.customerId);
          if (!prior || v.leadDate < prior) leadDates.set(v.customerId, v.leadDate);
        }
      });
      (ev.bookingAmounts || []).forEach((b: any) => {
        if (b.saleId && b.tdPrice != null) tdPriceMap.set(b.saleId, Number(b.tdPrice));
      });
    });

    const allVisits = Array.from(visitMap.values());
    const filteredVisits = activeProjectName 
      ? allVisits.filter(v => v.projectName === activeProjectName)
      : allVisits;
    const hasRealVisits = allVisits.length > 0;

    // Build unified records from sales (RPC or fallback)
    let records: any[] = [];

    if (data.sales && data.sales.length > 0) {
      records = data.sales.map((s: any) => {
        const matchingPlot = data.plots.find((p: any) => p.id === s.plotId || (p.plot_name === s.plotName && p.project_name === s.projectName));
        const salePrice = s.salePrice ? Number(s.salePrice) : Number(matchingPlot?.selling_price || 0);
        const bookDate = s.importedHistory?.bookedDate || s.bookedAt?.split('T')[0] || null;
        const transferDate = ['transferred', 'handover'].includes(s.stage) 
          ? (s.importedHistory?.transferredDate || s.transferredAt?.split('T')[0] || null) 
          : null;
        const cancelDate = s.stage === 'cancelled' 
          ? (s.importedHistory?.cancelledDate || s.cancelledAt?.split('T')[0] || null) 
          : null;
        const customerLeadDate = s.customerId ? leadDates.get(s.customerId) : null;
        const createdDate = customerLeadDate || bookDate || s.created_at?.split('T')[0] || '2025-01-01';
        const tdPrice = s.saleId ? tdPriceMap.get(s.saleId) : null;

        const status = s.stage === 'cancelled' ? 'Cancelled' 
          : ['transferred', 'handover'].includes(s.stage) ? 'Transferred' 
          : 'Reserved';

        const statusLabel = s.stage === 'transferred' ? 'โอนแล้ว' 
          : s.stage === 'cancelled' ? 'ยกเลิก' 
          : ['booked', 'contracted'].includes(s.stage) ? 'จองแล้ว' 
          : 'รอโอน';

        return {
          id: s.saleId,
          saleId: s.saleId,
          plot_id: s.plotId,
          plot_name: s.plotName || s.plotId,
          project_name: s.projectName,
          customer_name: s.customerName || 'ลูกค้าไม่ระบุชื่อ',
          phone: s.phone || '-',
          agent_name: s.ownerName || '-',
          salePrice,
          status,
          statusLabel,
          stage: s.stage,
          bookDate,
          transferDate,
          cancelDate,
          createdDate,
          expectedTransfer: s.expectedTransferDate || s.expected_transfer_date || matchingPlot?.expected_transfer_date || null,
          plot: matchingPlot || { id: s.plotId, plot_name: s.plotName, project_name: s.projectName, selling_price: salePrice },
          sale: { ...s, tdPrice: tdPrice ?? s.tdPrice }
        };
      });
    } else if (data.fallbackSales && data.fallbackSales.length > 0) {
      records = data.fallbackSales.map((s: any) => {
        const matchingPlot = data.plots.find((p: any) => p.id === s.plot_id);
        const matchingLead = data.leads?.find((l: any) => l.id === s.lead_id);
        const salePrice = s.sale_price ? Number(s.sale_price) : Number(matchingPlot?.selling_price || 0);
        const status = s.contract_status === 'Cancelled' || s.crm_stage === 'cancelled' ? 'Cancelled' 
          : s.contract_status === 'Transferred' || s.crm_stage === 'transferred' ? 'Transferred' 
          : 'Reserved';
        return {
          id: s.id,
          plot_id: s.plot_id,
          plot_name: matchingPlot?.plot_name || s.plot_id,
          project_name: matchingPlot?.project_name || 'ไม่ระบุ',
          customer_name: matchingLead?.customer_name || 'ลูกค้าไม่ระบุชื่อ',
          phone: matchingLead?.phone || '-',
          agent_name: matchingLead?.agent_name || '-',
          salePrice,
          status,
          stage: s.crm_stage || s.contract_status,
          bookDate: s.booked_at?.split('T')[0] || s.created_at?.split('T')[0] || null,
          transferDate: s.transferred_at?.split('T')[0] || null,
          cancelDate: s.cancelled_at?.split('T')[0] || null,
          createdDate: s.created_at?.split('T')[0] || '2025-01-01',
          expectedTransfer: s.expected_transfer_date || s.expectedTransferDate || matchingPlot?.expected_transfer_date || null,
          plot: matchingPlot,
          sale: s
        };
      });
    }

    // Filter records by project if specified
    const filteredRecords = activeProjectName 
      ? records.filter((r: any) => r.plot?.project_name === activeProjectName || r.project_name === activeProjectName)
      : records;

    const validRecords = filteredRecords.filter((r: any) => (r.createdDate || r.bookDate || '') <= targetDate.toISOString().split('T')[0]);

    // Annual and monthly KPIs
    const viewsAcc = hasRealVisits
      ? filteredVisits.filter((v: any) => v.visitDate && v.visitDate.startsWith(selectedYear) && v.visitDate <= targetDate.toISOString().split('T')[0]).length
      : validRecords.filter((r: any) => r.createdDate && r.createdDate.startsWith(selectedYear) && r.createdDate <= targetDate.toISOString().split('T')[0]).length;

    const bookedAcc = filteredRecords.filter((r: any) => r.bookDate && r.bookDate.startsWith(selectedYear) && r.bookDate <= targetDate.toISOString().split('T')[0] && (!r.cancelDate || r.cancelDate > targetDate.toISOString().split('T')[0]));
    const cancelAcc = filteredRecords.filter((r: any) => r.cancelDate && r.cancelDate.startsWith(selectedYear) && r.cancelDate <= targetDate.toISOString().split('T')[0]);
    const transferAcc = filteredRecords.filter((r: any) => r.transferDate && r.transferDate.startsWith(selectedYear) && r.transferDate <= targetDate.toISOString().split('T')[0]);

    const viewsMonth = hasRealVisits
      ? filteredVisits.filter((v: any) => v.visitDate && v.visitDate.startsWith(targetMonthPrefix) && v.visitDate <= targetDate.toISOString().split('T')[0])
      : validRecords.filter((r: any) => r.createdDate.startsWith(targetMonthPrefix));
    const bookedMonth = filteredRecords.filter((r: any) => r.bookDate?.startsWith(targetMonthPrefix));
    const transferMonth = filteredRecords.filter((r: any) => r.transferDate?.startsWith(targetMonthPrefix));
    const cancelMonth = filteredRecords.filter((r: any) => r.cancelDate?.startsWith(targetMonthPrefix));

    const expectingTransfer = filteredRecords.filter((r: any) => r.expectedTransfer && r.expectedTransfer.startsWith(targetMonthPrefix) && !r.transferDate && (!r.cancelDate || r.cancelDate > targetMonthPrefix));
    const carriedOverTransfers = filteredRecords.filter((r: any) => r.expectedTransfer && r.expectedTransfer < targetMonthPrefix && !r.transferDate && (!r.cancelDate || r.cancelDate > targetMonthPrefix));

    // Group sales by plotId
    const salesByPlot = new Map<string, any[]>();
    filteredRecords.forEach((s: any) => {
      const pid = s.plot_id || s.plot?.id;
      if (pid) {
        if (!salesByPlot.has(pid)) salesByPlot.set(pid, []);
        salesByPlot.get(pid)!.push(s);
      }
    });

    const targetDateStr = targetDate.toISOString().split('T')[0];

    const projectGroups: Record<string, {
      total: number, transferred: number, waiting: number, available: number, priorTransferred: number,
      transVal: number, waitVal: number, availVal: number, priorTransVal: number,
      transAppraisal: number, waitAppraisal: number, priorTransAppraisal: number,
      transferredPlots: any[], waitingPlots: any[], availablePlots: any[], priorTransferredPlots: any[]
    }> = {};

    activePlots.forEach((p: any) => {
      const isInfra = p.house_types?.is_infrastructure || data.houseTypes?.find((h: any) => h.id === p.house_type_id)?.is_infrastructure;
      if (isInfra) return;

      const proj = p.project_name || 'ไม่ระบุ';
      if (!projectGroups[proj]) {
        projectGroups[proj] = {
          total: 0, transferred: 0, waiting: 0, available: 0, priorTransferred: 0,
          transVal: 0, waitVal: 0, availVal: 0, priorTransVal: 0,
          transAppraisal: 0, waitAppraisal: 0, priorTransAppraisal: 0,
          transferredPlots: [], waitingPlots: [], availablePlots: [], priorTransferredPlots: []
        };
      }

      const plotSales = salesByPlot.get(p.id) || [];

      // 1. Sale transferred in selectedYear (up to targetDateStr)
      const transferInYear = plotSales.find((s: any) => 
        ['transferred', 'handover'].includes((s.stage || s.status || '').toLowerCase()) &&
        s.transferDate && s.transferDate.startsWith(selectedYear) && s.transferDate <= targetDateStr
      );

      // 2. Sale transferred in a prior year (< selectedYear-01-01)
      const transferPrior = plotSales.find((s: any) => 
        ['transferred', 'handover'].includes((s.stage || s.status || '').toLowerCase()) &&
        s.transferDate && s.transferDate < `${selectedYear}-01-01`
      );

      // 3. Active waiting sale (booked on or before targetDateStr, not cancelled, not transferred yet)
      const waitingSale = plotSales.find((s: any) => 
        s.stage !== 'cancelled' && s.status !== 'Cancelled' &&
        !['transferred', 'handover'].includes((s.stage || s.status || '').toLowerCase()) &&
        (!s.bookDate || s.bookDate <= targetDateStr) &&
        (!s.cancelDate || s.cancelDate > targetDateStr)
      );

      let price = Number(p.selling_price || 0);
      let appraisal = Number(p.land_appraisal_price || 0);

      projectGroups[proj].total++;

      if (transferInYear) {
        price = transferInYear.salePrice ? Number(transferInYear.salePrice) : price;
        appraisal = transferInYear.sale?.tdPrice || appraisal || price;
        if (appraisal <= 0) appraisal = price;

        projectGroups[proj].transferred++;
        projectGroups[proj].transVal += price;
        projectGroups[proj].transAppraisal += appraisal;
        projectGroups[proj].transferredPlots.push({ ...p, activeSale: transferInYear, price, appraisal });
      } else if (waitingSale || (!transferPrior && ['booked', 'contracted', 'reserved'].includes((p.sale_status || '').toLowerCase()))) {
        const sale = waitingSale || plotSales.find((s: any) => s.stage !== 'cancelled' && s.status !== 'Cancelled');
        price = sale?.salePrice ? Number(sale.salePrice) : price;
        appraisal = sale?.sale?.tdPrice || appraisal || price;
        if (appraisal <= 0) appraisal = price;

        projectGroups[proj].waiting++;
        projectGroups[proj].waitVal += price;
        projectGroups[proj].waitAppraisal += appraisal;
        projectGroups[proj].waitingPlots.push({ ...p, activeSale: sale, price, appraisal });
      } else if (transferPrior || (!transferInYear && (p.sale_status || '').toLowerCase() === 'transferred')) {
        const sale = transferPrior || plotSales.find((s: any) => ['transferred', 'handover'].includes((s.stage || s.status || '').toLowerCase()));
        price = sale?.salePrice ? Number(sale.salePrice) : price;
        appraisal = sale?.sale?.tdPrice || appraisal || price;
        if (appraisal <= 0) appraisal = price;

        projectGroups[proj].priorTransferred++;
        projectGroups[proj].priorTransVal += price;
        projectGroups[proj].priorTransAppraisal += appraisal;
        projectGroups[proj].priorTransferredPlots.push({ ...p, activeSale: sale, price, appraisal });
      } else {
        if (appraisal <= 0) appraisal = price;
        projectGroups[proj].available++;
        projectGroups[proj].availVal += price;
        projectGroups[proj].availablePlots.push({ ...p, price, appraisal });
      }
    });

    const closedProjects = new Set(
      (data.projects || []).filter((p: any) => p.is_closed).map((p: any) => p.name)
    );

    const allProjectsList = Object.entries(projectGroups).filter(([proj, stats]) => {
      if (selectedProjectFilter && selectedProjectFilter !== 'all') {
        return proj === selectedProjectFilter;
      }
      const isClosed = closedProjects.has(proj);
      const yearTotal = stats.transferred + stats.waiting + stats.available;
      return !isClosed && yearTotal > 0;
    });

    let sumYearTransVal = 0, sumYearWaitVal = 0, sumAvailVal = 0, sumPriorTransVal = 0;
    let sumYearTransAppraisal = 0, sumYearWaitAppraisal = 0, sumPriorTransAppraisal = 0;
    let sumYearTransCnt = 0, sumYearWaitCnt = 0, sumAvailCnt = 0, sumPriorTransCnt = 0, sumTotalCnt = 0;

    allProjectsList.forEach(([_, stats]) => {
      sumYearTransVal += stats.transVal; 
      sumYearWaitVal += stats.waitVal; 
      sumAvailVal += stats.availVal;
      sumPriorTransVal += stats.priorTransVal;

      sumYearTransAppraisal += stats.transAppraisal; 
      sumYearWaitAppraisal += stats.waitAppraisal;
      sumPriorTransAppraisal += stats.priorTransAppraisal;

      sumYearTransCnt += stats.transferred; 
      sumYearWaitCnt += stats.waiting; 
      sumAvailCnt += stats.available; 
      sumPriorTransCnt += stats.priorTransferred;
      sumTotalCnt += stats.total;
    });

    const sumYearSalesVal = sumYearTransVal + sumYearWaitVal;
    const sumYearSalesCnt = sumYearTransCnt + sumYearWaitCnt;
    const sumYearSalesAppraisal = sumYearTransAppraisal + sumYearWaitAppraisal;
    const sumYearTotalVal = sumYearTransVal + sumYearWaitVal + sumAvailVal;
    const sumYearTotalCnt = sumYearTransCnt + sumYearWaitCnt + sumAvailCnt;

    // Extract all active waiting plots from allProjectsList (connecting 100% to CRM V2 sales/plots)
    const allWaitingPlots = allProjectsList.flatMap(([_, stats]) => stats.waitingPlots);

    const carriedOverPlots: any[] = [];
    const expectingThisMonthPlots: any[] = [];
    const unscheduledPlots: any[] = [];

    allWaitingPlots.forEach(plot => {
      const expDate = plot.activeSale?.expectedTransfer || plot.activeSale?.expectedTransferDate || plot.activeSale?.expected_transfer_date || plot.expected_transfer_date;
      if (expDate && expDate.startsWith(targetMonthPrefix)) {
        expectingThisMonthPlots.push(plot);
      } else if (expDate && expDate < targetMonthPrefix) {
        carriedOverPlots.push(plot);
      } else {
        unscheduledPlots.push(plot);
      }
    });

    const transferMonthPlots = transferMonth.map((r: any) => r.plot || {
      id: r.plot_id,
      plot_name: r.plot_name,
      project_name: r.project_name,
      selling_price: r.salePrice
    }).filter(Boolean);

    const transferMonthVal = transferMonth.reduce((sum: number, r: any) => sum + (r.salePrice || 0), 0);
    const waitingTotalVal = allWaitingPlots.reduce((sum: number, p: any) => sum + (p.price || 0), 0);
    const totalTransferPipelineCount = transferMonth.length + allWaitingPlots.length;
    const totalTransferPipelineVal = transferMonthVal + waitingTotalVal;

    // Annual Gross (all sales booked in selectedYear including cancellations)
    const annualGrossSales = filteredRecords.filter((r: any) => r.bookDate && r.bookDate.startsWith(selectedYear));
    const annualGrossSalePrice = annualGrossSales.reduce((acc: number, r: any) => acc + (r.salePrice || 0), 0);
    const annualGrossTdPrice = annualGrossSales.reduce((acc: number, r: any) => acc + (Number(r.plot?.land_appraisal_price || r.salePrice || 0)), 0);

    const projChartData = allProjectsList.map(([proj, _]) => {
      const bMonth = bookedMonth.filter((r: any) => (r.plot?.project_name === proj || r.project_name === proj)).length;
      const tMonth = transferMonth.filter((r: any) => (r.plot?.project_name === proj || r.project_name === proj)).length;
      return { project: proj, booking: bMonth, transfer: tMonth };
    });

    const months = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    const years = ['2023', '2024', '2025', '2026'];

    const buildLineData = (dateField: string) => months.map((m, idx) => {
      const obj: any = { month: m };
      years.forEach(y => {
        const prefix = `${y}-${String(idx + 1).padStart(2, '0')}`;
        obj[`y${y}`] = filteredRecords.filter((r: any) => r[dateField]?.startsWith(prefix)).length;
      });
      return obj;
    });

    const lineChartTransfers = buildLineData('transferDate');
    const lineChartBookings = buildLineData('bookDate');
    const lineChartViews = months.map((m, idx) => {
      const obj: any = { month: m };
      years.forEach(y => {
        const prefix = `${y}-${String(idx + 1).padStart(2, '0')}`;
        obj[`y${y}`] = hasRealVisits
          ? filteredVisits.filter((v: any) => v.visitDate?.startsWith(prefix)).length
          : filteredRecords.filter((r: any) => r.createdDate?.startsWith(prefix)).length;
      });
      return obj;
    });

    let accTransfers = 0;
    let accBookings = 0;
    let accViews = 0;

    const currentActualYear = new Date().getFullYear().toString();
    const currentActualMonth = new Date().getMonth();

    const cumulativeChartTransfers = lineChartTransfers.map((item, idx) => {
      accTransfers += (item[`y${cumulativeYear}`] || 0);
      const isFuture = cumulativeYear === currentActualYear && idx > currentActualMonth;
      return { month: item.month, cumulative: isFuture ? null : accTransfers };
    });

    const cumulativeChartBookings = lineChartBookings.map((item, idx) => {
      accBookings += (item[`y${cumulativeYear}`] || 0);
      const isFuture = cumulativeYear === currentActualYear && idx > currentActualMonth;
      return { month: item.month, cumulative: isFuture ? null : accBookings };
    });

    const cumulativeChartViews = lineChartViews.map((item, idx) => {
      accViews += (item[`y${cumulativeYear}`] || 0);
      const isFuture = cumulativeYear === currentActualYear && idx > currentActualMonth;
      return { month: item.month, cumulative: isFuture ? null : accViews };
    });

    return {
      viewsAcc, bookedAcc, cancelAcc, transferAcc,
      viewsMonth, bookedMonth, transferMonth, cancelMonth,
      expectingTransfer: expectingThisMonthPlots,
      carriedOverTransfers: carriedOverPlots,
      allWaitingPlots,
      expectingThisMonthPlots,
      carriedOverPlots,
      unscheduledPlots,
      transferMonthPlots,
      totalTransferPipelineCount,
      totalTransferPipelineVal,
      activeProjects: allProjectsList,
      sumYearTransVal, sumYearWaitVal, sumAvailVal, sumPriorTransVal, sumYearTotalVal,
      sumYearTransAppraisal, sumYearWaitAppraisal, sumPriorTransAppraisal,
      sumYearTransCnt, sumYearWaitCnt, sumAvailCnt, sumPriorTransCnt, sumYearTotalCnt, sumTotalCnt,
      sumYearSalesVal, sumYearSalesCnt, sumYearSalesAppraisal,
      sumTransVal: sumYearTransVal, sumWaitVal: sumYearWaitVal,
      sumTransAppraisal: sumYearTransAppraisal, sumWaitAppraisal: sumYearWaitAppraisal,
      sumTransCnt: sumYearTransCnt, sumWaitCnt: sumYearWaitCnt,
      annualGrossSalePrice, annualGrossTdPrice, annualGrossCount: annualGrossSales.length,
      projectGroups,
      projChartData,
      lineChartTransfers,
      lineChartBookings,
      lineChartViews,
      cumulativeChartTransfers,
      cumulativeChartBookings,
      cumulativeChartViews,
      rawValidRecords: validRecords
    };
  }, [data, selectedDateStr, cumulativeYear, selectedProjectFilter, project]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-3 text-slate-500">
      <Loader2 className="animate-spin text-blue-600" size={40} />
      <span className="text-sm font-semibold">กำลังโหลดข้อมูลการขายและแปลงบ้านทั้งหมด…</span>
    </div>
  );

  if (!metrics) return <div className="p-8 text-center text-gray-500">ไม่พบข้อมูลในระบบ</div>;

  // Filter customer list by search keyword
  const displayCustomers = customerSearch.trim()
    ? metrics.rawValidRecords.filter((r: any) => {
        const query = customerSearch.toLowerCase();
        return (
          (r.customer_name || '').toLowerCase().includes(query) ||
          (r.phone || '').toLowerCase().includes(query) ||
          (r.plot?.plot_name || r.plot_name || '').toLowerCase().includes(query) ||
          (r.plot?.project_name || r.project_name || '').toLowerCase().includes(query) ||
          (r.agent_name || '').toLowerCase().includes(query)
        );
      })
    : metrics.rawValidRecords;

  return (
    <div className="bg-[#f8fafc] h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
        
        {/* HEADER */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="bg-blue-900 text-white w-12 h-12 flex items-center justify-center rounded-lg text-2xl font-bold font-serif shadow-inner">A</div>
            <div>
              <h1 className="text-2xl font-black text-blue-900 tracking-tight">Monthly Sale Report {selectedYear}</h1>
              <p className="text-sm font-semibold text-gray-500 tracking-wide uppercase mt-0.5">SOMSAMAI PROPERTY COMPANY LIMITED</p>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-3 lg:gap-4">
            {/* Project Filter */}
            <div className="flex items-center gap-2 bg-gray-50 p-1.5 px-3 rounded-xl border border-gray-200 shadow-sm">
              <Building2 className="w-4 h-4 text-blue-600" />
              <span className="text-xs font-bold text-gray-500">โครงการ:</span>
              <select
                aria-label="เลือกโครงการ"
                value={selectedProjectFilter ?? ''}
                onChange={e => setSelectedProjectFilter(e.target.value || null)}
                className="bg-transparent border-none text-sm font-bold text-blue-900 focus:ring-0 cursor-pointer outline-none"
              >
                <option value="">ทุกโครงการ</option>
                {(data.projects || []).filter((p: any) => !p.is_closed).map((p: any) => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>

            {/* KPI Badges */}
            <div className="bg-indigo-50 p-2.5 px-4 rounded-xl border border-indigo-100 shadow-sm flex items-center gap-4">
              <div>
                <div className="text-indigo-800 text-[10px] font-bold uppercase tracking-wider mb-0.5 flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div> ยอดขายรวม (โอน + จอง) ปี {selectedYear}
                </div>
                <div className="flex items-baseline gap-2">
                  <div className="text-xl font-black text-indigo-700">{fmtM(metrics.sumYearSalesVal)}</div>
                  <div className="text-[11px] font-bold text-indigo-500 hidden sm:block">
                    {metrics.sumYearSalesCnt} หลัง
                  </div>
                </div>
              </div>
              <div className="border-l border-indigo-200/60 pl-3">
                <div className="text-rose-600 text-[10px] font-bold uppercase tracking-wider mb-0.5 flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-rose-500"></div> ยอด ท.ด. ปี {selectedYear}
                </div>
                <div className="text-xl font-black text-rose-600">{fmtM(metrics.sumYearSalesAppraisal)}</div>
              </div>
            </div>
            
            {/* Date Picker */}
            <div className="flex items-center gap-2 bg-gray-50 p-1.5 px-3 rounded-xl border border-gray-200 shadow-sm">
              <Calendar className="w-4 h-4 text-blue-600" />
              <input 
                type="date" 
                value={selectedDateStr} 
                onChange={e => {
                  setUserSelectedDate(true);
                  setSelectedDateStr(e.target.value);
                }}
                className="bg-transparent border-none text-sm font-bold text-gray-800 focus:ring-0 cursor-pointer outline-none"
              />
            </div>
          </div>
        </div>

        {/* ROW 1: KPI SUMMARY CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col gap-4">
            <div className="flex justify-between items-center mb-1 pb-3 border-b border-gray-100">
               <span className="font-bold text-gray-800 text-base">ยอดสะสมประจำปี {selectedYear}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-bold text-gray-600 text-sm">ยอดลูกค้าเข้าชมสะสม</span>
              <span className="text-2xl font-black text-blue-900">{metrics.viewsAcc}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-bold text-gray-600 text-sm">ยอดลูกค้าจองสะสม</span>
              <span className="text-2xl font-black text-blue-900">{metrics.bookedAcc.length}</span>
            </div>
            <div className="flex justify-between items-center bg-red-50 p-3 -mx-3 rounded-lg border border-red-100">
              <span className="font-bold text-red-600 text-sm">ยอดลูกค้ายกเลิกสะสม</span>
              <span className="text-2xl font-black text-red-600">{metrics.cancelAcc.length}</span>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-blue-600" />
                <span className="font-bold text-gray-800">ประจำเดือน {selectedMonth}/{selectedYear}</span>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-600 text-sm font-medium">ยอดเข้าชม</span>
                <span className="text-lg font-bold text-gray-900">{metrics.viewsMonth.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600 text-sm font-medium">ยอดจอง</span>
                <span className="text-lg font-bold text-blue-600">{metrics.bookedMonth.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600 text-sm font-medium">ยอดโอน</span>
                <span className="text-lg font-bold text-emerald-600">{metrics.transferMonth.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600 text-sm font-medium">ยอดยกเลิก</span>
                <span className="text-lg font-bold text-red-600">{metrics.cancelMonth.length}</span>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-blue-900 to-indigo-900 p-5 rounded-2xl shadow-md text-white flex flex-col">
            <div className="text-blue-100 text-sm font-medium mb-1">ภาพรวมการโอนเดือนนี้ (สำเร็จ + คาดการณ์)</div>
            <div className="flex items-end gap-2 mb-2">
              <span className="text-4xl font-black">{metrics.totalTransferPipelineCount}</span>
              <span className="text-blue-200 font-medium mb-1">หลัง</span>
            </div>
            <div className="text-sm text-blue-200 font-medium bg-white/10 p-2 rounded inline-block mt-2 self-start">
              {fmtM(metrics.totalTransferPipelineVal)}
            </div>
            
            <div className="mt-4 pt-4 border-t border-white/20">
              <div className="grid grid-cols-2 gap-4">
                {/* โอนแล้ว */}
                <div>
                  <div className="text-emerald-400 text-xs font-bold mb-2 flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div>
                    โอนแล้ว ({metrics.transferMonth.length})
                  </div>
                  <div className="text-blue-200 text-xs font-medium space-y-1 max-h-36 overflow-y-auto custom-scrollbar">
                    {metrics.transferMonth.length > 0 ? [...metrics.transferMonth].sort((a: any, b: any) => {
                      const nameA = a.plot?.project_name && a.plot?.plot_name ? `${a.plot.project_name}-${a.plot.plot_name}` : (a.project_name && a.plot_name ? `${a.project_name}-${a.plot_name}` : '-');
                      const nameB = b.plot?.project_name && b.plot?.plot_name ? `${b.plot.project_name}-${b.plot.plot_name}` : (b.project_name && b.plot_name ? `${b.project_name}-${b.plot_name}` : '-');
                      return nameA.localeCompare(nameB, 'th', { numeric: true });
                    }).map((r: any) => {
                      const label = r.plot?.project_name && r.plot?.plot_name ? `${r.plot.project_name}-${r.plot.plot_name}` : `${r.project_name}-${r.plot_name}`;
                      return (
                        <div key={r.id || r.saleId} className="truncate text-emerald-100/90" title={label}>
                          • {label}
                        </div>
                      );
                    }) : <div className="text-blue-300/50 italic">- ไม่มี -</div>}
                  </div>
                </div>
                
                {/* คาดว่าจะโอน */}
                <div>
                  <div className="text-amber-400 text-xs font-bold mb-2 flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400"></div>
                    รอโอน ({metrics.allWaitingPlots.length})
                  </div>
                  <div className="text-blue-200 text-xs font-medium space-y-1 max-h-36 overflow-y-auto custom-scrollbar">
                    {metrics.allWaitingPlots.length > 0 ? [...metrics.allWaitingPlots].sort((a: any, b: any) => {
                      const nameA = a.project_name && a.plot_name ? `${a.project_name}-${a.plot_name}` : (a.plot?.project_name ? `${a.plot.project_name}-${a.plot.plot_name}` : '-');
                      const nameB = b.project_name && b.plot_name ? `${b.project_name}-${b.plot_name}` : (b.plot?.project_name ? `${b.plot.project_name}-${b.plot.plot_name}` : '-');
                      return nameA.localeCompare(nameB, 'th', { numeric: true });
                    }).map((p: any) => {
                      const label = p.project_name && p.plot_name ? `${p.project_name}-${p.plot_name}` : (p.plot?.project_name ? `${p.plot.project_name}-${p.plot.plot_name}` : '-');
                      return (
                        <div key={p.id} className="truncate text-amber-100/90" title={label}>
                          • {label}
                        </div>
                      );
                    }) : <div className="text-blue-300/50 italic">- ไม่มี -</div>}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div 
            className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between h-full cursor-pointer hover:bg-slate-50 transition-colors relative group"
            onClick={() => setShowTotalBreakdown(true)}
          >
            <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="bg-white text-gray-400 p-1.5 rounded-lg shadow-sm border border-gray-100"><BarChart size={16} /></div>
            </div>
            <div className="px-2">
              <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1 group-hover:text-gray-700 transition-colors">บ้านทั้งหมด (ปี {selectedYear})</div>
              <div className="text-xl font-black text-gray-800">{fmtM(metrics.sumYearTotalVal)}</div>
              <div className="flex justify-between mt-1 text-xs text-gray-500 font-medium">
                <span>{metrics.sumYearTotalCnt} หลัง</span>
                <span>เฉลี่ย {fmtM(metrics.sumYearTotalVal / (metrics.sumYearTotalCnt || 1))}/หลัง</span>
              </div>
            </div>

            <div className="px-2">
              <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">ยอดโอนสะสม (ปี {selectedYear})</div>
              <div className="text-xl font-black text-emerald-600">{fmtM(metrics.sumYearTransVal)}</div>
              <div className="flex justify-between mt-1 text-xs text-gray-500 font-medium">
                <span>{metrics.sumYearTransCnt} หลัง</span>
                <span className="text-rose-500">ท.ด. {fmtM(metrics.sumYearTransAppraisal)}</span>
              </div>
            </div>

            <div className="px-2">
              <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">ยอดรอโอน (ปี {selectedYear})</div>
              <div className="text-xl font-black text-blue-600">{fmtM(metrics.sumYearWaitVal)}</div>
              <div className="flex justify-between mt-1 text-xs text-gray-500 font-medium">
                <span>{metrics.sumYearWaitCnt} หลัง</span>
                <span className="text-rose-500">ท.ด. {fmtM(metrics.sumYearWaitAppraisal)}</span>
              </div>
            </div>

            <div className="px-2">
              <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">ยอดคงเหลือ (ว่าง)</div>
              <div className="text-xl font-black text-gray-800">{fmtM(metrics.sumAvailVal)}</div>
              <div className="flex justify-between mt-1 text-xs text-gray-500 font-medium">
                <span>{metrics.sumAvailCnt} หลัง</span>
                <span>เฉลี่ย {fmtM(metrics.sumAvailVal / (metrics.sumAvailCnt || 1))}/หลัง</span>
              </div>
            </div>
          </div>
        </div>

        {/* ROW 2: CHARTS */}
        <div className="grid grid-cols-1 gap-6 mt-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h3 className="text-base font-bold text-gray-800 mb-6 flex items-center gap-2"><BarChart className="w-5 h-5 text-blue-600"/> ยอดจองและโอนประจำเดือน แต่ละโครงการ</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={metrics.projChartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="project" tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} />
                  <RechartsTooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                  <Legend iconType="circle" wrapperStyle={{fontSize: 12, paddingTop: '20px'}} />
                  <Bar dataKey="booking" name="ยอดจองประจำเดือน" fill="#93c5fd" radius={[4,4,0,0]} barSize={24} />
                  <Bar dataKey="transfer" name="ยอดโอนประจำเดือน" fill="#3b82f6" radius={[4,4,0,0]} barSize={24} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* ROW 3: DETAILED TABLES */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 mt-6">
          <div className="xl:col-span-8">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden h-full flex flex-col">
              <div className="flex-1 p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="p-3 text-left font-bold text-gray-700">โครงการ</th>
                      <th className="p-3 text-right font-bold text-emerald-600">โอน</th>
                      <th className="p-3 text-right font-bold text-blue-600">รอโอน</th>
                      <th className="p-3 text-right font-bold text-gray-500">ว่าง</th>
                      <th className="p-3 text-right font-bold text-gray-900 bg-gray-100">ทั้งหมด</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.activeProjects.map(([proj, stats]: [string, any]) => {
                      const isExpanded = expandedProjects.has(proj);
                      const yearTotal = stats.transferred + stats.waiting + stats.available;
                      return (
                        <React.Fragment key={proj}>
                          <tr 
                            onClick={() => toggleProjectExpand(proj)}
                            className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer"
                          >
                            <td className="p-3 font-semibold text-gray-800 flex items-center gap-2">
                              {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                              {proj}
                            </td>
                            <td className="p-3 text-right font-medium text-emerald-600">{stats.transferred}</td>
                            <td className="p-3 text-right font-medium text-blue-600">{stats.waiting}</td>
                            <td className="p-3 text-right text-gray-500">{stats.available}</td>
                            <td className="p-3 text-right font-bold bg-gray-50 text-gray-900">{yearTotal}</td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-slate-50/50 border-b border-gray-100">
                              <td className="p-3 text-xs font-bold text-gray-400 text-right align-top pt-4">รายชื่อแปลง:</td>
                              <td className="p-3 text-xs text-emerald-600 align-top text-right pt-4 space-y-1">
                                {[...stats.transferredPlots].sort((a: any, b: any) => (a.plot_name || '').localeCompare(b.plot_name || '', 'th', { numeric: true })).map((p: any) => (
                                  <div key={p.id}>{p.plot_name}</div>
                                ))}
                              </td>
                              <td className="p-3 text-xs text-blue-600 align-top text-right pt-4 space-y-1">
                                {[...stats.waitingPlots].sort((a: any, b: any) => (a.plot_name || '').localeCompare(b.plot_name || '', 'th', { numeric: true })).map((p: any) => (
                                  <div key={p.id}>{p.plot_name}</div>
                                ))}
                              </td>
                              <td className="p-3 text-xs text-gray-500 align-top text-right pt-4 space-y-1">
                                {[...stats.availablePlots].sort((a: any, b: any) => (a.plot_name || '').localeCompare(b.plot_name || '', 'th', { numeric: true })).map((p: any) => (
                                  <div key={p.id}>{p.plot_name}</div>
                                ))}
                              </td>
                              <td className="p-3 bg-gray-50/50 border-l border-white"></td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                    <tr className="bg-blue-50 border-t-2 border-blue-200">
                      <td className="p-3 font-black text-blue-900">Grand Total</td>
                      <td className="p-3 text-right font-black text-emerald-700">{metrics.sumTransCnt}</td>
                      <td className="p-3 text-right font-black text-blue-700">{metrics.sumWaitCnt}</td>
                      <td className="p-3 text-right font-bold text-gray-700">{metrics.sumAvailCnt}</td>
                      <td className="p-3 text-right font-black text-blue-900">{metrics.sumYearTotalCnt}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="xl:col-span-4">
            {/* MONTHLY DETAILS CARD (3 COLUMNS) */}
            <div className="bg-white p-4 lg:p-5 rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="grid grid-cols-3 gap-2">
                {/* Column 1: Booked */}
                <div>
                  <div className="text-[11px] lg:text-xs font-bold text-slate-700 mb-3 leading-tight text-center">
                    รายการที่<br/>จองในเดือน
                  </div>
                  <div className="flex justify-center">
                    <div className="text-[11px] lg:text-xs font-medium text-sky-700 space-y-1 text-left whitespace-nowrap">
                      {metrics.bookedMonth.length > 0 
                        ? [...metrics.bookedMonth].sort((a: any, b: any) => {
                            const nameA = a.plot?.project_name && a.plot?.plot_name ? `${a.plot.project_name}-${a.plot.plot_name}` : '-';
                            const nameB = b.plot?.project_name && b.plot?.plot_name ? `${b.plot.project_name}-${b.plot.plot_name}` : '-';
                            return nameA.localeCompare(nameB, 'th', { numeric: true });
                          }).map((r: any) => (
                            <div key={r.id}>
                              {r.plot?.project_name && r.plot?.plot_name ? `${r.plot.project_name}-${r.plot.plot_name}` : '-'}
                            </div>
                          ))
                        : <div className="text-center text-slate-400">-</div>
                      }
                    </div>
                  </div>
                </div>

                {/* Column 2: Transferred */}
                <div>
                  <div className="text-[11px] lg:text-xs font-bold text-slate-700 mb-3 leading-tight text-center">
                    รายการโอน<br/>ภายในเดือน
                  </div>
                  <div className="flex justify-center">
                    <div className="text-[11px] lg:text-xs font-medium text-sky-700 space-y-1 text-left whitespace-nowrap">
                      {metrics.transferMonth.length > 0 
                        ? [...metrics.transferMonth].sort((a: any, b: any) => {
                            const nameA = a.plot?.project_name && a.plot?.plot_name ? `${a.plot.project_name}-${a.plot.plot_name}` : '-';
                            const nameB = b.plot?.project_name && b.plot?.plot_name ? `${b.plot.project_name}-${b.plot.plot_name}` : '-';
                            return nameA.localeCompare(nameB, 'th', { numeric: true });
                          }).map((r: any) => (
                            <div key={r.id}>
                              {r.plot?.project_name && r.plot?.plot_name ? `${r.plot.project_name}-${r.plot.plot_name}` : '-'}
                            </div>
                          ))
                        : <div className="text-center text-slate-400">-</div>
                      }
                    </div>
                  </div>
                </div>

                {/* Column 3: Cancelled */}
                <div>
                  <div className="text-[11px] lg:text-xs font-bold text-red-600 mb-3 leading-tight text-center">
                    รายการยกเลิก<br/>ในเดือน
                  </div>
                  <div className="flex justify-center">
                    <div className="text-[11px] lg:text-xs font-medium text-red-600 space-y-1 text-left whitespace-nowrap">
                      {metrics.cancelMonth.length > 0 
                        ? [...metrics.cancelMonth].sort((a: any, b: any) => {
                            const nameA = a.plot?.project_name && a.plot?.plot_name ? `${a.plot.project_name}-${a.plot.plot_name}` : '-';
                            const nameB = b.plot?.project_name && b.plot?.plot_name ? `${b.plot.project_name}-${b.plot.plot_name}` : '-';
                            return nameA.localeCompare(nameB, 'th', { numeric: true });
                          }).map((r: any) => (
                            <div key={r.id}>
                              {r.plot?.project_name && r.plot?.plot_name ? `${r.plot.project_name}-${r.plot.plot_name}` : '-'}
                            </div>
                          ))
                        : <div className="text-center text-slate-400">-</div>
                      }
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* LINE CHARTS */}
        <div className="mt-4">
          <div className="flex items-center gap-3 mb-6">
            <TrendingUp className="text-blue-600 w-7 h-7 p-1.5 bg-blue-100 rounded-lg" />
            <h2 className="text-xl font-bold text-gray-800">สรุปยอดจองและยอดโอน บจก. สมสมัย</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-80">
              <h3 className="text-center font-bold text-gray-700 mb-4">ยอดโอน ปี 2023 - 2026 (หลัง)</h3>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={metrics.lineChartTransfers} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{fontSize: 12, fill: '#64748b', fontWeight: 600}} axisLine={false} tickLine={false} dy={10} />
                  <YAxis allowDecimals={false} tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} dx={-10} />
                  <RechartsTooltip 
                    contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} 
                    labelStyle={{ fontWeight: 'bold', color: '#1e293b', marginBottom: '8px' }}
                  />
                  <Legend wrapperStyle={{ paddingTop: '20px' }} />
                  <Line type="monotone" dataKey="y2023" name="ปี 2023" stroke="#e2e8f0" strokeWidth={2} strokeDasharray="5 5" dot={{r: 3, fill: '#f8fafc', stroke: '#e2e8f0', strokeWidth: 1}} activeDot={{r: 5, strokeWidth: 0}} />
                  <Line type="monotone" dataKey="y2024" name="ปี 2024" stroke="#e2e8f0" strokeWidth={2} strokeDasharray="5 5" dot={{r: 3, fill: '#f8fafc', stroke: '#e2e8f0', strokeWidth: 1}} activeDot={{r: 5, strokeWidth: 0}} />
                  <Area type="monotone" dataKey="y2025" name="ปี 2025 (ปีที่แล้ว)" fill="#f1f5f9" stroke="#cbd5e1" strokeWidth={2} dot={{r: 3, fill: '#cbd5e1', strokeWidth: 0}} activeDot={{r: 5, fill: '#94a3b8', strokeWidth: 0}} />
                  <Line type="monotone" dataKey="y2026" name="ปี 2026 (ปัจจุบัน)" stroke="#6366f1" strokeWidth={4} dot={{r: 5, fill: '#ffffff', stroke: '#6366f1', strokeWidth: 2}} activeDot={{r: 8, strokeWidth: 0}} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-80">
              <h3 className="text-center font-bold text-gray-700 mb-4">ยอดจอง ปี 2023 - 2026 (หลัง)</h3>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={metrics.lineChartBookings} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{fontSize: 12, fill: '#64748b', fontWeight: 600}} axisLine={false} tickLine={false} dy={10} />
                  <YAxis allowDecimals={false} tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} dx={-10} />
                  <RechartsTooltip 
                    contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} 
                    labelStyle={{ fontWeight: 'bold', color: '#1e293b', marginBottom: '8px' }}
                  />
                  <Legend wrapperStyle={{ paddingTop: '20px' }} />
                  <Line type="monotone" dataKey="y2023" name="ปี 2023" stroke="#e2e8f0" strokeWidth={2} strokeDasharray="5 5" dot={{r: 3, fill: '#f8fafc', stroke: '#e2e8f0', strokeWidth: 1}} activeDot={{r: 5, strokeWidth: 0}} />
                  <Line type="monotone" dataKey="y2024" name="ปี 2024" stroke="#e2e8f0" strokeWidth={2} strokeDasharray="5 5" dot={{r: 3, fill: '#f8fafc', stroke: '#e2e8f0', strokeWidth: 1}} activeDot={{r: 5, strokeWidth: 0}} />
                  <Area type="monotone" dataKey="y2025" name="ปี 2025 (ปีที่แล้ว)" fill="#f1f5f9" stroke="#cbd5e1" strokeWidth={2} dot={{r: 3, fill: '#cbd5e1', strokeWidth: 0}} activeDot={{r: 5, fill: '#94a3b8', strokeWidth: 0}} />
                  <Line type="monotone" dataKey="y2026" name="ปี 2026 (ปัจจุบัน)" stroke="#6366f1" strokeWidth={4} dot={{r: 5, fill: '#ffffff', stroke: '#6366f1', strokeWidth: 2}} activeDot={{r: 8, strokeWidth: 0}} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-80">
            <h3 className="text-center font-bold text-gray-700 mb-4">ยอดเข้าชม ปี 2023 - 2026 (ครั้ง)</h3>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={metrics.lineChartViews} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{fontSize: 12, fill: '#64748b', fontWeight: 600}} axisLine={false} tickLine={false} dy={10} />
                <YAxis allowDecimals={false} tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} dx={-10} />
                <RechartsTooltip 
                  contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} 
                  labelStyle={{ fontWeight: 'bold', color: '#1e293b', marginBottom: '8px' }}
                />
                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                <Line type="monotone" dataKey="y2023" name="ปี 2023" stroke="#e2e8f0" strokeWidth={2} strokeDasharray="5 5" dot={{r: 3, fill: '#f8fafc', stroke: '#e2e8f0', strokeWidth: 1}} activeDot={{r: 5, strokeWidth: 0}} />
                <Line type="monotone" dataKey="y2024" name="ปี 2024" stroke="#e2e8f0" strokeWidth={2} strokeDasharray="5 5" dot={{r: 3, fill: '#f8fafc', stroke: '#e2e8f0', strokeWidth: 1}} activeDot={{r: 5, strokeWidth: 0}} />
                <Area type="monotone" dataKey="y2025" name="ปี 2025 (ปีที่แล้ว)" fill="#f1f5f9" stroke="#cbd5e1" strokeWidth={2} dot={{r: 3, fill: '#cbd5e1', strokeWidth: 0}} activeDot={{r: 5, fill: '#94a3b8', strokeWidth: 0}} />
                <Line type="monotone" dataKey="y2026" name="ปี 2026 (ปัจจุบัน)" stroke="#6366f1" strokeWidth={4} dot={{r: 5, fill: '#ffffff', stroke: '#6366f1', strokeWidth: 2}} activeDot={{r: 8, strokeWidth: 0}} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* CUMULATIVE CHARTS */}
        <div className="mt-8 pt-6 border-t border-gray-200">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
            <div className="flex items-center gap-3">
              <TrendingUp className="text-emerald-600 w-7 h-7 p-1.5 bg-emerald-100 rounded-lg" />
              <h2 className="text-xl font-bold text-gray-800">สรุปยอดสะสม (Cumulative) ประจำปี</h2>
            </div>
            <div className="flex items-center gap-2 bg-white p-1.5 px-3 rounded-lg border border-gray-200 shadow-sm">
              <span className="text-sm font-bold text-gray-600">เลือกปี:</span>
              <select 
                value={cumulativeYear}
                onChange={e => setCumulativeYear(e.target.value)}
                className="bg-transparent border-none text-sm font-bold text-emerald-700 focus:ring-0 cursor-pointer outline-none"
              >
                <option value="2023">2023</option>
                <option value="2024">2024</option>
                <option value="2025">2025</option>
                <option value="2026">2026</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {/* Cumulative Transfers */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-80">
              <h3 className="text-center font-bold text-gray-700 mb-4">ยอดโอนสะสม ปี {cumulativeYear} (หลัง)</h3>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={metrics.cumulativeChartTransfers} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{fontSize: 12, fill: '#64748b', fontWeight: 600}} axisLine={false} tickLine={false} dy={10} />
                  <YAxis allowDecimals={false} tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} dx={-10} />
                  <RechartsTooltip 
                    contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} 
                    labelStyle={{ fontWeight: 'bold', color: '#1e293b', marginBottom: '8px' }}
                  />
                  <Area type="monotone" dataKey="cumulative" name="ยอดโอนสะสม" fill="#d1fae5" stroke="#10b981" strokeWidth={3} dot={{r: 4, fill: '#ffffff', stroke: '#10b981', strokeWidth: 2}} activeDot={{r: 7, strokeWidth: 0}}>
                    <LabelList dataKey="cumulative" position="top" offset={10} style={{ fill: '#059669', fontSize: 11, fontWeight: 'bold' }} />
                  </Area>
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Cumulative Bookings */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-80">
              <h3 className="text-center font-bold text-gray-700 mb-4">ยอดจองสะสม ปี {cumulativeYear} (หลัง)</h3>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={metrics.cumulativeChartBookings} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{fontSize: 12, fill: '#64748b', fontWeight: 600}} axisLine={false} tickLine={false} dy={10} />
                  <YAxis allowDecimals={false} tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} dx={-10} />
                  <RechartsTooltip 
                    contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} 
                    labelStyle={{ fontWeight: 'bold', color: '#1e293b', marginBottom: '8px' }}
                  />
                  <Area type="monotone" dataKey="cumulative" name="ยอดจองสะสม" fill="#dbeafe" stroke="#3b82f6" strokeWidth={3} dot={{r: 4, fill: '#ffffff', stroke: '#3b82f6', strokeWidth: 2}} activeDot={{r: 7, strokeWidth: 0}}>
                    <LabelList dataKey="cumulative" position="top" offset={10} style={{ fill: '#2563eb', fontSize: 11, fontWeight: 'bold' }} />
                  </Area>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-80">
            <h3 className="text-center font-bold text-gray-700 mb-4">ยอดเข้าชมสะสม ปี {cumulativeYear} (ครั้ง)</h3>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={metrics.cumulativeChartViews} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{fontSize: 12, fill: '#64748b', fontWeight: 600}} axisLine={false} tickLine={false} dy={10} />
                <YAxis allowDecimals={false} tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} dx={-10} />
                <RechartsTooltip 
                  contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} 
                  labelStyle={{ fontWeight: 'bold', color: '#1e293b', marginBottom: '8px' }}
                />
                <Area type="monotone" dataKey="cumulative" name="ยอดเข้าชมสะสม" fill="#f3e8ff" stroke="#a855f7" strokeWidth={3} dot={{r: 4, fill: '#ffffff', stroke: '#a855f7', strokeWidth: 2}} activeDot={{r: 7, strokeWidth: 0}}>
                  <LabelList dataKey="cumulative" position="top" offset={10} style={{ fill: '#9333ea', fontSize: 11, fontWeight: 'bold' }} />
                </Area>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* WAITING FOR TRANSFER DETAILS */}
        <div className="mt-8 pt-6 border-t-2 border-gray-200">
          <WaitingForTransferDetails 
            plots={[
              ...metrics.transferMonthPlots,
              ...metrics.expectingThisMonthPlots
            ].filter((plot: any, index: number, self: any[]) => self.findIndex((p: any) => p.id === plot.id) === index)}
            carriedOverPlots={metrics.carriedOverPlots.filter((plot: any, index: number, self: any[]) => self.findIndex((p: any) => p.id === plot.id) === index)}
            unscheduledPlots={metrics.unscheduledPlots.filter((plot: any, index: number, self: any[]) => self.findIndex((p: any) => p.id === plot.id) === index)}
            validRecords={metrics.rawValidRecords}
            onViewDefects={onViewDefects}
          />
        </div>

        {/* DETAILED TABLE LIST */}
        <div className="mt-8 pt-6 border-t-2 border-gray-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="bg-blue-100 p-2 rounded-lg">
                <Users className="text-blue-600 w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-800">รายชื่อลูกค้า (Customer List)</h2>
                <p className="text-xs text-gray-500">ข้อมูลจากสัญญาการจองและโอนกรรมสิทธิ์จริง</p>
              </div>
            </div>

            {/* Customer Search Bar */}
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={customerSearch}
                onChange={e => setCustomerSearch(e.target.value)}
                placeholder="ค้นหาชื่อลูกค้า, แปลง, โครงการ..."
                className="w-full pl-9 pr-4 py-2 bg-white rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-sm"
              />
              {customerSearch && (
                <button onClick={() => setCustomerSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600">✕</button>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                  <tr>
                    <th className="p-3 font-bold text-gray-700">ลำดับ</th>
                    <th className="p-3 font-bold text-gray-700">วันที่</th>
                    <th className="p-3 font-bold text-gray-700">รายชื่อลูกค้า</th>
                    <th className="p-3 font-bold text-gray-700">เบอร์โทร</th>
                    <th className="p-3 font-bold text-gray-700">โครงการ/บ้านเลขที่</th>
                    <th className="p-3 font-bold text-gray-700">ราคาขาย</th>
                    <th className="p-3 font-bold text-gray-700">Sale</th>
                    <th className="p-3 font-bold text-gray-700">สถานะ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {displayCustomers.map((r: any, idx: number) => (
                    <tr key={r.id || idx} className="hover:bg-gray-50 transition-colors">
                      <td className="p-3 text-gray-600">{idx + 1}</td>
                      <td className="p-3 text-gray-600">{r.bookDate || r.createdDate}</td>
                      <td className="p-3 font-medium text-gray-900">{r.customer_name}</td>
                      <td className="p-3 text-gray-600">{r.phone || '-'}</td>
                      <td className="p-3 text-gray-600 font-medium">{r.plot?.project_name || r.project_name || '-'} / {r.plot?.plot_name || r.plot_name || '-'}</td>
                      <td className="p-3 text-blue-600 font-medium">{r.salePrice ? fmtM(r.salePrice) : '-'}</td>
                      <td className="p-3 text-gray-600">{r.agent_name || '-'}</td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded text-xs font-bold ${
                          ['Transferred', 'Handover'].includes(r.status) ? 'bg-emerald-100 text-emerald-700' :
                          ['Reserved', 'Contracted', 'DownPayment', 'DocumentPrep', 'LoanProcessing', 'Approved'].includes(r.status) ? 'bg-blue-100 text-blue-700' :
                          r.status === 'Cancelled' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'
                        }`}>
                          {r.statusLabel || r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {displayCustomers.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-6 text-center text-gray-500">
                        {customerSearch ? `ไม่พบข้อมูลที่ตรงกับ "${customerSearch}"` : 'ไม่มีข้อมูลลูกค้าในปีและเดือนที่เลือก'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      </div>

      {showTotalBreakdown && (
        <div className="fixed inset-0 z-[500] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 shrink-0">
              <div>
                <h3 className="text-xl font-black text-gray-800">รายละเอียดรวมบ้านทั้งหมด (ปี {selectedYear})</h3>
                <p className="text-sm text-gray-500 font-medium">ยอดรวมจากราคาขายตามสัญญาและราคาตั้งต้นของทุกสถานะ</p>
              </div>
              <button onClick={() => setShowTotalBreakdown(false)} className="w-10 h-10 rounded-full hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-colors">
                ✕
              </button>
            </div>
            <div className="p-6 overflow-y-auto dark-scrollbar flex-1 bg-white">
              {metrics.activeProjects.map(([proj, group]: [string, any]) => {
                const allPlots = [
                  ...group.transferredPlots.map((p: any) => ({...p, __status: `โอนแล้ว (ปี ${selectedYear})`})), 
                  ...group.waitingPlots.map((p: any) => ({...p, __status: 'รอโอน'})), 
                  ...group.availablePlots.map((p: any) => ({...p, __status: 'ว่าง'}))
                ];
                if (allPlots.length === 0) return null;
                return (
                  <div key={proj} className="mb-8 last:mb-0">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="bg-slate-800 text-white p-2 rounded-lg">
                        <Building2 size={18} />
                      </div>
                      <h4 className="text-lg font-bold text-gray-800">{proj}</h4>
                      <div className="ml-auto text-right">
                        <div className="text-lg font-black text-slate-800">{fmtM(group.transVal + group.waitVal + group.availVal)}</div>
                        <div className="text-xs text-slate-500 font-medium">{group.transferred + group.waiting + group.available} แปลง</div>
                      </div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 border-b border-gray-100 text-slate-500 text-xs uppercase">
                          <tr>
                            <th className="px-4 py-3 font-bold">แปลง</th>
                            <th className="px-4 py-3 font-bold">สถานะ</th>
                            <th className="px-4 py-3 font-bold text-right">ราคาขาย / ราคาตั้ง</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {allPlots.sort((a: any, b: any) => a.plot_name?.localeCompare(b.plot_name, 'th', { numeric: true })).map((p: any) => (
                            <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-4 py-3 font-bold text-slate-700">{p.plot_name}</td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-1 rounded text-[10px] font-bold ${
                                  p.__status.startsWith('โอนแล้ว (ปี') ? 'bg-emerald-100 text-emerald-700' : 
                                  p.__status === 'รอโอน' ? 'bg-blue-100 text-blue-700' : 
                                  p.__status === 'ว่าง' ? 'bg-gray-100 text-gray-700' : 
                                  'bg-purple-100 text-purple-700'
                                }`}>{p.__status}</span>
                              </td>
                              <td className="px-4 py-3 font-bold text-right text-slate-700">{fmtM(p.price || p.selling_price || 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

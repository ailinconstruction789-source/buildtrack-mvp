"use client";

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchSalesWithoutLimit } from '@/lib/sales/fetchWithoutLimit';
import { extractAgreedPrices } from '@/lib/sales/customerDealDetails';
import SalesReports from './SalesReports';
import { Loader2 } from 'lucide-react';

export default function SalesReportsView({ project, viewType = 'reports' }: { project: any, viewType?: 'reports' | 'agent' }) {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const projName = project?.name;
      try {
        const [plotsData, nativeLeads, salesResult] = await Promise.all([
          fetchSalesWithoutLimit('plots', {
            filterCol: projName ? 'project_name' : undefined,
            filterVal: projName,
            select: 'id, plot_name, selling_price, land_appraisal_price, project_name, highlight_note',
            orderBy: 'id',
            ascending: true
          }),
          fetchSalesWithoutLimit('leads', {
            filterCol: projName ? 'project_name' : undefined,
            filterVal: projName,
            select: '*',
            orderBy: 'created_at',
            ascending: false
          }),
          fetchSalesWithoutLimit('sales', {
            select: '*, plots(*)',
            orderBy: 'created_at',
            ascending: false
          })
        ]);

        if (!nativeLeads || nativeLeads.length === 0) {
          setLeads([]);
          setLoading(false);
          return;
        }

        const chunkArray = (arr: any[], size: number) => Array.from({ length: Math.ceil(arr.length / size) }, (v, i) => arr.slice(i * size, i * size + size));
        const leadIds = nativeLeads.map((l: any) => l.id);
        const chunks = chunkArray(leadIds, 100);

        const historyResults = await Promise.all(
          chunks.map(chunk => supabase.from('status_history').select('*').in('entity_id', chunk).order('created_at', { ascending: true }))
        );
        const historyData = historyResults.flatMap(r => r.data || []);

        const formattedLeads = nativeLeads.map((l: any) => {
          const sale = salesResult?.find((s: any) =>
            s.lead_id === l.id ||
            (l.interested_plot_id && s.plot_id === l.interested_plot_id) ||
            (l.interested_plot_name && s.plot_id === `${l.project_name}-${l.interested_plot_name}`) ||
            (s.plots && s.plots.project_name === l.project_name && s.plots.plot_name === l.interested_plot_name) ||
            (l.customer_name && s.plots?.highlight_note && s.plots.highlight_note.includes(l.customer_name.trim()))
          );

          const matchingPlot = plotsData?.find((p: any) =>
            (sale && (p.id === sale.plot_id || p.plot_name === sale.plot_id)) ||
            p.id === l.interested_plot_id ||
            (p.plot_name === l.interested_plot_name && (!l.project_name || p.project_name === l.project_name)) ||
            p.id === `${l.project_name}-${l.interested_plot_name}`
          );

          const history = historyData?.filter((h: any) => h.entity_id === l.id).map((h: any) => ({
            status: h.new_status,
            timestamp: h.created_at,
            note: h.changed_by
          })) || [];

          const explicitReserved = history.find((h: any) => h.status === 'Reserved')?.timestamp?.split('T')[0];
          const saleCreatedAt = sale?.created_at?.split('T')[0];
          const leadBookingDate = l.booking_date?.split('T')[0];
          const bookingDate = leadBookingDate || explicitReserved || sale?.booked_at?.split('T')[0] || saleCreatedAt || l.created_at?.split('T')[0] || null;

          const leadTransferDate = l.transferred_date?.split('T')[0];
          const saleTransferDate = sale?.transferred_at?.split('T')[0] || sale?.crm_transfer_date?.split('T')[0];
          const transferredDate = leadTransferDate || saleTransferDate || null;

          const { salePrice: notesSalePrice, landAppraisalPrice: notesLandPrice } = extractAgreedPrices(l.notes);

          const rawSellingPrice = (sale?.sale_price && Number(sale.sale_price) > 0)
            ? Number(sale.sale_price)
            : (notesSalePrice ?? (matchingPlot?.selling_price ? Number(matchingPlot.selling_price) : 0));

          let rawLandAppraisal = (sale?.land_office_price && Number(sale.land_office_price) > 0)
            ? Number(sale.land_office_price)
            : (notesLandPrice ?? (matchingPlot?.land_appraisal_price && Number(matchingPlot.land_appraisal_price) > 0 ? Number(matchingPlot.land_appraisal_price) : 0));

          if (rawLandAppraisal === 0 && rawSellingPrice > 0) {
            rawLandAppraisal = rawSellingPrice;
          }

          const plotCode = sale?.plots?.plot_name
            || matchingPlot?.plot_name
            || l.interested_plot_name
            || sale?.plot_id
            || l.interested_plot_id
            || null;

          return {
            id: l.id,
            name: l.customer_name,
            project: l.project_name,
            status: l.status,
            plot: plotCode,
            salePrice: rawSellingPrice,
            landAppraisalPrice: rawLandAppraisal,
            expectedTransferDate: sale?.expected_transfer_date || null,
            bookingDate,
            transferredDate,
            agentName: l.agent_name || 'ไม่ระบุ',
            created_at: l.created_at,
            history
          };
        });

        setLeads(formattedLeads);
      } catch (e) {
        console.error('Error fetching sales data for reports:', e);
      }
      setLoading(false);
    };

    fetchData();
  }, [project]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-blue-600" size={48} />
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden flex flex-col bg-[#f8fafc]">
      <header className="bg-white border-b border-gray-200 px-8 py-5 flex items-center justify-between shrink-0 shadow-sm z-10">
        <div>
          <h1 className="text-2xl font-black text-[#0f172a] tracking-tight">
            {viewType === 'agent' ? 'สรุปผลงานพนักงานขาย' : 'รายงานสรุปยอด'} {project ? `- ${project.name}` : '(รวมทุกโครงการ)'}
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {viewType === 'agent' ? 'สรุปผลงานของฝ่ายขายแยกตามบุคคล' : 'สรุปข้อมูลการจองและการโอนกรรมสิทธิ์'}
          </p>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-2 md:p-6">
        <div className="bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.02)] border border-gray-100 min-h-full">
          <SalesReports leads={leads} projectName={project?.name || 'ทุกโครงการ'} viewType={viewType} />
        </div>
      </div>
    </div>
  );
}

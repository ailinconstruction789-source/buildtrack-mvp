import { supabase } from '@/lib/supabase';
import {
  filterAvailablePlots,
  type InterestedPlot,
  type PlotRentalContractSnapshot,
  type PlotSaleSnapshot,
} from './plotAvailability';

const PAGE_SIZE = 500;

/**
 * Read-only canonical available-plot lookup across plots, sales, and rental_contracts.
 * Fails closed on any query error — never treats missing or unreadable tables as vacant.
 */
export async function loadAvailablePlots(projectName: string): Promise<InterestedPlot[]> {
  if (!projectName || projectName === 'all') return [];
  const plots: InterestedPlot[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('plots')
      .select('id, plot_name, project_name, has_customer, sale_status, current_tenant_name, rental_program, lease_start_date, highlight_note')
      .eq('project_name', projectName)
      .order('id')
      .range(offset, offset + PAGE_SIZE - 1);
    if (error || !data) throw new Error('ตรวจสอบแปลงว่างไม่สำเร็จ กรุณาลองใหม่');
    plots.push(...(data as InterestedPlot[]));
    if (data.length < PAGE_SIZE) break;
  }

  const sales: PlotSaleSnapshot[] = [];
  const rentalContracts: PlotRentalContractSnapshot[] = [];

  // Fetch by plot, not by the visible Lead list: other Sales may have booked or rented it.
  for (let start = 0; start < plots.length; start += 100) {
    const ids = plots.slice(start, start + 100).map(plot => plot.id);

    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('sales')
        .select('id, plot_id, contract_status, crm_stage')
        .in('plot_id', ids)
        .order('id')
        .range(offset, offset + PAGE_SIZE - 1);
      if (error || !data) throw new Error('ตรวจสอบรายการจองไม่สำเร็จ ยังเลือกแปลงไม่ได้');
      sales.push(...(data as PlotSaleSnapshot[]));
      if (data.length < PAGE_SIZE) break;
    }

    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('rental_contracts')
        .select('id, plot_id, status')
        .in('plot_id', ids)
        .order('id')
        .range(offset, offset + PAGE_SIZE - 1);
      if (error || !data) throw new Error('ตรวจสอบสัญญาเช่าและรายการจองเช่าไม่สำเร็จ ยังเลือกแปลงไม่ได้');
      rentalContracts.push(...(data as PlotRentalContractSnapshot[]));
      if (data.length < PAGE_SIZE) break;
    }
  }

  return filterAvailablePlots(plots, sales, projectName, rentalContracts);
}

/** Recheck immediately before saving INTEREST only. This is not a booking lock. */
export async function recheckInterestedPlot(projectName: string, plotId: string | null): Promise<InterestedPlot | null> {
  if (!plotId) return null;
  const plot = (await loadAvailablePlots(projectName)).find(item => item.id === plotId);
  if (!plot) throw new Error('แปลงที่เลือกไม่ว่างแล้วหรือไม่อยู่ในโครงการนี้ กรุณาเลือกใหม่หรือล้างตัวเลือก');
  return plot;
}

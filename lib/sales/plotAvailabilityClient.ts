import { supabase } from '@/lib/supabase';
import { filterAvailablePlots, type InterestedPlot, type PlotSaleSnapshot } from './plotAvailability';

const PAGE_SIZE = 500;

/** Read existing tables only; works with string OR UUID plot IDs without casting. */
export async function loadAvailablePlots(projectName: string): Promise<InterestedPlot[]> {
  if (!projectName || projectName === 'all') return [];
  const plots: InterestedPlot[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase.from('plots')
      .select('id, plot_name, project_name, has_customer, sale_status')
      .eq('project_name', projectName).order('id').range(offset, offset + PAGE_SIZE - 1);
    if (error || !data) throw new Error('ตรวจสอบแปลงว่างไม่สำเร็จ กรุณาลองใหม่');
    plots.push(...data as InterestedPlot[]);
    if (data.length < PAGE_SIZE) break;
  }
  const sales: PlotSaleSnapshot[] = [];
  // Fetch by plot, not by the visible Lead list: other Sales may have booked it.
  for (let start = 0; start < plots.length; start += 100) {
    const ids = plots.slice(start, start + 100).map(plot => plot.id);
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase.from('sales')
        .select('id, plot_id, contract_status').in('plot_id', ids)
        .order('id').range(offset, offset + PAGE_SIZE - 1);
      if (error || !data) throw new Error('ตรวจสอบรายการจองไม่สำเร็จ ยังเลือกแปลงไม่ได้');
      sales.push(...data as PlotSaleSnapshot[]);
      if (data.length < PAGE_SIZE) break;
    }
  }
  return filterAvailablePlots(plots, sales, projectName);
}

/** Recheck immediately before saving INTEREST only. This is not a booking lock. */
export async function recheckInterestedPlot(projectName: string, plotId: string | null): Promise<InterestedPlot | null> {
  if (!plotId) return null;
  const plot = (await loadAvailablePlots(projectName)).find(item => item.id === plotId);
  if (!plot) throw new Error('แปลงที่เลือกไม่ว่างแล้วหรือไม่อยู่ในโครงการนี้ กรุณาเลือกใหม่หรือล้างตัวเลือก');
  return plot;
}

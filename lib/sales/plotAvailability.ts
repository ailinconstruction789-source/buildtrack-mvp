/** Legacy-compatible stock reads. An expression of interest never reserves stock. */
export interface InterestedPlot {
  id: string;
  plot_name: string | null;
  project_name: string;
  has_customer: boolean | null;
  sale_status: string | null;
}

export interface PlotSaleSnapshot {
  plot_id: string | null;
  contract_status: string | null;
}

// `active` means construction is active, NOT that the plot has a buyer.
// Unknown status values are withheld for review, not silently treated as vacant.
const VACANT_STATUSES = new Set(['', 'active', 'normal', 'ready_for_sale', 'available', 'vacant']);

export function filterAvailablePlots(
  plots: readonly InterestedPlot[],
  sales: readonly PlotSaleSnapshot[],
  projectName: string,
): InterestedPlot[] {
  if (!projectName || projectName === 'all') return [];
  const occupied = new Set(sales
    .filter(sale => (sale.contract_status ?? '').trim().toLowerCase() !== 'cancelled')
    .map(sale => sale.plot_id));
  return plots.filter(plot =>
    plot.project_name === projectName &&
    plot.has_customer === false &&
    VACANT_STATUSES.has((plot.sale_status ?? '').trim().toLowerCase()) &&
    !occupied.has(plot.id),
  ).sort((a, b) => (a.plot_name || a.id).localeCompare(b.plot_name || b.id, 'th', { numeric: true }));
}

export function searchAvailablePlots(plots: readonly InterestedPlot[], search: string): InterestedPlot[] {
  const query = search.trim().toLocaleLowerCase();
  return plots.filter(plot => !query || `${plot.plot_name ?? ''} ${plot.id}`.toLocaleLowerCase().includes(query));
}

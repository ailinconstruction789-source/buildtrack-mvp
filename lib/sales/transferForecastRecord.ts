interface ForecastRecord {
  id?: string; saleId?: string; plot_id?: string | null; plotId?: string | null; plot?: { id?: string };
  status?: string; stage?: string; createdDate?: string; customer_name?: string; customerName?: string;
  expectedTransfer?: string | null; expectedTransferDate?: string | null; expected_transfer_date?: string | null;
  transferDate?: string | null; transferredAt?: string | null; [key: string]: unknown;
}
interface ForecastPlot { id: string; plot_name?: string; project_name?: string; activeSale?: ForecastRecord; [key: string]: unknown }
/** A forecast belongs to the exact active booking, never the latest import timestamp. */
export function transferForecastRecord(plot: ForecastPlot, records: ForecastRecord[], canonical: boolean): ForecastRecord | undefined {
  const currentSaleId = plot.activeSale?.saleId ?? plot.activeSale?.id;
  if (currentSaleId) {
    const exact = records.filter(row => (row.saleId ?? row.id) === currentSaleId && (row.plot_id ?? row.plotId ?? row.plot?.id) === plot.id);
    if (exact.length === 1) return exact[0];
    if (canonical) return exact.length === 0 ? plot.activeSale : undefined;
  }
  const scoped = records.filter(row => (row.plot_id ?? row.plotId ?? row.plot?.id) === plot.id
    || !canonical && row.plot_name === plot.plot_name && row.project_name === plot.project_name);
  if (canonical) {
    const active = scoped.filter(row => !/cancel|transfer|handover/i.test(String(row.stage ?? row.status ?? '')));
    return active.length === 1 ? active[0] : undefined;
  }
  return [...scoped].sort((a, b) => (b.createdDate ?? '').localeCompare(a.createdDate ?? ''))[0] ?? plot.activeSale;
}

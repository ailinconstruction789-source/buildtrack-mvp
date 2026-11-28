import { customerBusinessDay } from './customerBusinessDate';
import { customerDealDetails, extractAgreedPrices } from './customerDealDetails';
import { classifySalesDeal } from './dealClassification';
import { getLeadStage } from './leadStage';
import { salesDealStageOf } from './dealStatus';
import { isExternalProject } from '../projectUtils';

export interface SalesIntelligenceRecord {
  id: string;
  leadId: string | null;
  saleId: string | null;
  name: string;
  project: string;
  status: string;
  stage: string;
  isRental: boolean;
  isBooked: boolean;
  isTransferred: boolean;
  isCancelledBooking: boolean;
  isBankRejected: boolean;
  plot: string | null;
  plotName: string | null;
  salePrice: number;
  rawSellingPrice: number;
  landSize: number;
  houseModel: string;
  expectedTransferDate: string | null;
  bookingDate: string | null;
  transferDate: string | null;
  visitDate: string | null;
  agentName: string;
  source: string;
  bankStatus: string;
  cancelReason: string;
  created_at: string | null;
}

export interface ProjectMeta {
  name: string;
  is_closed?: boolean;
  plotCount?: number;
}

const BOOKING_STATUS_SET = new Set([
  'reserved',
  'booked',
  'contracted',
  'contract signed',
  'downpayment',
  'down payment',
  'documentprep',
  'document prep',
  'loanprocessing',
  'loan processing',
  'bank processing',
  'loanrejected',
  'bank rejected',
  'approved',
  'bank approved',
  'transferpending',
  'transfer pending',
  'transferred',
  'handover',
]);

const TRANSFER_STATUS_SET = new Set(['transferred', 'handover', 'won']);
const CANCEL_STATUS_SET = new Set(['cancelled', 'canceled', 'refunded', 'lost']);

const BANK_REJECT_REASON_RE =
  /กู้ไม่ผ่าน|สินเชื่อไม่ผ่าน|ไม่ผ่านสินเชื่อ|ไม่ผ่านกู้|ติดบูโร|บูโร|เครดิต|ภาระหนี้|แบงก์ไม่ผ่าน|ธนาคารไม่ผ่าน|reject/i;

function normalizePlotKey(val: unknown): string {
  if (typeof val !== 'string') return '';
  const trimmed = val.trim();
  if (!trimmed) return '';
  const dashIdx = trimmed.lastIndexOf('-');
  return (dashIdx >= 0 ? trimmed.slice(dashIdx + 1) : trimmed).trim().toLowerCase();
}

function toPositiveNumber(val: unknown): number {
  if (val === null || val === undefined || val === '') return 0;
  const num = Number(String(val).replace(/,/g, ''));
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function extractNoteCancelReason(notes: unknown): string {
  if (typeof notes !== 'string' || !notes) return '';
  const match = notes.match(/(?:^|\n)\s*•?\s*(?:เหตุผล(?:การยกเลิก)?|สาเหตุ(?:การยกเลิก)?):\s*([^\r\n]+)/);
  return match?.[1]?.trim() || '';
}

function resolveEffectiveSalePrice(sale: any, lead: any, plot: any): number {
  const fromSale = toPositiveNumber(sale?.sale_price);
  if (fromSale > 0) return fromSale;

  const agreed = extractAgreedPrices(lead?.notes);
  if (agreed.salePrice && agreed.salePrice > 0) return agreed.salePrice;

  const details = customerDealDetails(lead?.notes);
  if (details.salePrice && details.salePrice > 0) return details.salePrice;

  const fromPlot = toPositiveNumber(plot?.selling_price ?? plot?.price ?? plot?.base_price);
  if (fromPlot > 0) return fromPlot;

  const fromLandOffice = toPositiveNumber(sale?.land_office_price ?? plot?.land_appraisal_price);
  if (fromLandOffice > 0) return fromLandOffice;

  return 0;
}

function isSaleCancelledRow(sale: any): boolean {
  if (!sale) return false;
  const cs = String(sale.contract_status || '').trim().toLowerCase();
  const st = String(sale.crm_stage || '').trim().toLowerCase();
  return cs === 'cancelled' || cs === 'canceled' || st === 'cancelled' || st === 'canceled';
}

function findPlotForRecord(
  plots: any[],
  projectName: string | null | undefined,
  plotId?: string | null,
  plotName?: string | null
): any | undefined {
  if (!plots.length) return undefined;
  const cleanId = typeof plotId === 'string' ? plotId.trim() : '';
  const cleanName = typeof plotName === 'string' ? plotName.trim() : '';
  const cleanProj = typeof projectName === 'string' ? projectName.trim() : '';

  if (cleanId) {
    const exact = plots.find(p => p.id === cleanId);
    if (exact) return exact;
  }

  if (cleanProj && cleanName) {
    const byProjAndName = plots.find(
      p => p.project_name === cleanProj && (p.plot_name === cleanName || p.id === `${cleanProj}-${cleanName}`)
    );
    if (byProjAndName) return byProjAndName;
  }

  if (cleanProj && cleanId) {
    const norm = normalizePlotKey(cleanId);
    const byProjNorm = plots.find(
      p => p.project_name === cleanProj && (p.plot_name === cleanId || normalizePlotKey(p.plot_name) === norm)
    );
    if (byProjNorm) return byProjNorm;
  }

  return undefined;
}

export function buildSalesIntelligenceRecords(input: {
  leads: any[];
  sales: any[];
  plots: any[];
  houseTypes: any[];
  history?: any[];
  projectName?: string | null;
}): SalesIntelligenceRecord[] {
  const { leads = [], sales = [], plots = [], houseTypes = [], history = [], projectName = null } = input;

  const houseTypeMap = new Map<string, string>();
  houseTypes.forEach(ht => {
    if (ht?.id && ht?.type_name) houseTypeMap.set(String(ht.id), String(ht.type_name));
  });

  const historyByLeadId = new Map<string, any[]>();
  history.forEach(h => {
    if (!h?.entity_id) return;
    const key = String(h.entity_id);
    const list = historyByLeadId.get(key) || [];
    list.push(h);
    historyByLeadId.set(key, list);
  });

  const plotById = new Map<string, any>();
  plots.forEach(p => {
    if (p?.id) plotById.set(String(p.id), p);
  });

  // Scope sales to the selected project (or exclude external projects in All mode)
  const scopedSales = sales.filter(s => {
    const salePlot = s?.plot_id ? plotById.get(String(s.plot_id)) : undefined;
    const saleProj = salePlot?.project_name || s?.project_name || s?.plots?.project_name || '';
    if (projectName) return saleProj === projectName;
    if (saleProj && isExternalProject(saleProj)) return false;
    return true;
  });

  // Index sales by lead_id (prefer non-cancelled / latest sale per lead)
  const salesByLeadId = new Map<string, any[]>();
  scopedSales.forEach(s => {
    if (!s?.lead_id) return;
    const key = String(s.lead_id);
    const list = salesByLeadId.get(key) || [];
    list.push(s);
    salesByLeadId.set(key, list);
  });

  const claimedSaleIds = new Set<string>();
  const records: SalesIntelligenceRecord[] = [];

  // 1. Build records from leads (scoped by project)
  const scopedLeads = leads.filter(l => {
    const lProj = l?.project_name || '';
    if (projectName) return lProj === projectName;
    if (lProj && isExternalProject(lProj)) return false;
    return true;
  });

  scopedLeads.forEach(l => {
    const deal = classifySalesDeal(l);
    const isRental =
      (deal.isRentalActive || deal.isRentalPending || deal.isRentalEnded) && !deal.isConvertedToBuy;

    const leadHistory = historyByLeadId.get(String(l.id)) || [];
    const leadSales = salesByLeadId.get(String(l.id)) || [];

    // Pick best matched sale for this lead: prefer active/transferred over cancelled, newest first
    let matchedSale: any = undefined;
    if (leadSales.length > 0) {
      const sorted = [...leadSales].sort((a, b) => {
        const aCancelled = isSaleCancelledRow(a) ? 1 : 0;
        const bCancelled = isSaleCancelledRow(b) ? 1 : 0;
        if (aCancelled !== bCancelled) return aCancelled - bCancelled;
        return String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''));
      });
      matchedSale = sorted[0];
    }

    // Resolve plot from matchedSale or lead's interested_plot_id/name
    const plot =
      (matchedSale?.plot_id ? plotById.get(String(matchedSale.plot_id)) : undefined) ||
      findPlotForRecord(plots, l.project_name, l.interested_plot_id, l.interested_plot_name);

    // Fallback: if lead has no lead_id-linked sale and is NOT a rental deal, try matching an unclaimed
    // unlinked (legacy_import) sale on the exact same plot with matching status bucket
    if (!matchedSale && !isRental && plot?.id) {
      const leadStage = getLeadStage(l);
      const leadIsCancelled = leadStage === 'lost' || CANCEL_STATUS_SET.has(String(l.status || '').trim().toLowerCase());
      const unlinked = scopedSales.find(s => {
        if (!s?.id || claimedSaleIds.has(String(s.id)) || s.lead_id) return false;
        if (s.plot_id !== plot.id) return false;
        return isSaleCancelledRow(s) === leadIsCancelled;
      });
      if (unlinked) matchedSale = unlinked;
    }

    if (matchedSale?.id) {
      claimedSaleIds.add(String(matchedSale.id));
    }

    const leadStage = getLeadStage(l);
    const saleStage = matchedSale ? salesDealStageOf(matchedSale) : null;
    const rawStatusLower = String(l.status || '').trim().toLowerCase();

    const visitDate =
      customerBusinessDay(l.actual_visit_date) ||
      customerBusinessDay(leadHistory.find(h => h.new_status === 'Visit')?.created_at) ||
      customerBusinessDay(l.created_at) ||
      null;

    const bookingDate =
      customerBusinessDay(l.booking_date) ||
      customerBusinessDay(matchedSale?.booked_at) ||
      customerBusinessDay(matchedSale?.imported_history?.bookedDate) ||
      customerBusinessDay(
        leadHistory.find(h => ['Reserved', 'Booked', 'booked'].includes(String(h.new_status || '')))?.created_at
      ) ||
      null;

    const transferDate =
      customerBusinessDay(matchedSale?.transferred_at) ||
      customerBusinessDay(matchedSale?.crm_transfer_date) ||
      customerBusinessDay(matchedSale?.imported_history?.transferredDate) ||
      customerBusinessDay(l.transferred_date) ||
      customerBusinessDay(
        leadHistory.find(h => ['Transferred', 'transferred'].includes(String(h.new_status || '')))?.created_at
      ) ||
      null;

    const isCancelledRaw =
      !isRental &&
      (leadStage === 'lost' ||
        CANCEL_STATUS_SET.has(rawStatusLower) ||
        (matchedSale ? isSaleCancelledRow(matchedSale) : false));

    const isTransferred =
      !isRental &&
      !isCancelledRaw &&
      (leadStage === 'transferred' ||
        saleStage === 'transferred' ||
        saleStage === 'handover' ||
        TRANSFER_STATUS_SET.has(rawStatusLower) ||
        Boolean(transferDate));

    const hasBookingEvidence = Boolean(
      matchedSale ||
        bookingDate ||
        toPositiveNumber(l.booking_amount) > 0 ||
        Boolean(l.interested_plot_id) ||
        leadHistory.some(h =>
          ['Reserved', 'Booked', 'Contracted', 'booked', 'contracted', 'loan_rejected', 'LoanRejected'].includes(
            String(h.new_status || '')
          )
        )
    );

    const isCancelledBooking =
      isCancelledRaw &&
      (rawStatusLower === 'cancelled' ||
        rawStatusLower === 'canceled' ||
        rawStatusLower === 'refunded' ||
        Boolean(matchedSale) ||
        (rawStatusLower === 'lost' && hasBookingEvidence));

    const isBooked =
      !isRental &&
      !isCancelledRaw &&
      (isTransferred ||
        leadStage === 'booked' ||
        leadStage === 'loan' ||
        BOOKING_STATUS_SET.has(rawStatusLower) ||
        (saleStage !== null && saleStage !== 'cancelled'));

    const cancelReason =
      String(matchedSale?.cancellation_reason || '').trim() ||
      String(l.lost_reason || '').trim() ||
      extractNoteCancelReason(l.notes) ||
      '';

    const isBankRejected =
      !isRental &&
      (String(matchedSale?.bank_status || '').trim().toLowerCase() === 'rejected' ||
        rawStatusLower === 'loanrejected' ||
        rawStatusLower === 'bank rejected' ||
        saleStage === 'loan_rejected' ||
        matchedSale?.cancellation_category === 'final_loan_rejection' ||
        (isCancelledBooking && BANK_REJECT_REASON_RE.test(cancelReason)));

    const salePrice = resolveEffectiveSalePrice(matchedSale, l, plot);
    const houseModel =
      (plot?.house_type_id ? houseTypeMap.get(String(plot.house_type_id)) : undefined) || 'ไม่ระบุ';

    const effectiveStatus = isTransferred
      ? 'Transferred'
      : isCancelledBooking
        ? 'Cancelled'
        : isBooked
          ? l.status || 'Booked'
          : l.status || 'Visit';

    records.push({
      id: String(l.id),
      leadId: String(l.id),
      saleId: matchedSale?.id ? String(matchedSale.id) : null,
      name: l.customer_name || 'ลูกค้าไม่ระบุชื่อ',
      project: l.project_name || plot?.project_name || 'Unknown',
      status: effectiveStatus,
      stage: isTransferred ? 'transferred' : isCancelledBooking ? 'cancelled' : isBooked ? 'booked' : leadStage,
      isRental,
      isBooked,
      isTransferred,
      isCancelledBooking,
      isBankRejected,
      plot: plot?.id || matchedSale?.plot_id || l.interested_plot_id || null,
      plotName: plot?.plot_name || l.interested_plot_name || null,
      salePrice,
      rawSellingPrice: toPositiveNumber(plot?.selling_price ?? plot?.price ?? plot?.base_price),
      landSize: Number(plot?.land_size || 0) || 0,
      houseModel,
      expectedTransferDate:
        customerBusinessDay(matchedSale?.expected_transfer_date) ||
        customerBusinessDay(l.expected_transfer_date) ||
        null,
      bookingDate,
      transferDate,
      visitDate,
      agentName: l.agent_name || l.sales_owner || matchedSale?.agent_name || 'ไม่ระบุ',
      source: l.source || l.channel || 'Walk-in',
      bankStatus: matchedSale?.bank_status || (isBankRejected ? 'Rejected' : 'Pending'),
      cancelReason,
      created_at: l.created_at || matchedSale?.created_at || null,
    });
  });

  // 2. Append unclaimed sales rows (legacy / CRM V2 sales without a linked lead row)
  scopedSales.forEach(s => {
    if (!s?.id || claimedSaleIds.has(String(s.id))) return;
    if (String((s as any).deal_type || '').toLowerCase() === 'rent') return;

    const plot = s.plot_id ? plotById.get(String(s.plot_id)) : undefined;
    const saleStage = salesDealStageOf(s);
    const isCancelled = isSaleCancelledRow(s);
    const transferDate =
      customerBusinessDay(s.transferred_at) ||
      customerBusinessDay(s.crm_transfer_date) ||
      customerBusinessDay(s.imported_history?.transferredDate) ||
      null;
    const bookingDate =
      customerBusinessDay(s.booked_at) ||
      customerBusinessDay(s.imported_history?.bookedDate) ||
      customerBusinessDay(s.created_at) ||
      null;

    const isTransferred =
      !isCancelled && (saleStage === 'transferred' || saleStage === 'handover' || Boolean(transferDate));
    const isBooked = !isCancelled;
    const cancelReason = String(s.cancellation_reason || '').trim();
    const isBankRejected =
      String(s.bank_status || '').trim().toLowerCase() === 'rejected' ||
      saleStage === 'loan_rejected' ||
      s.cancellation_category === 'final_loan_rejection' ||
      (isCancelled && BANK_REJECT_REASON_RE.test(cancelReason));

    const salePrice = resolveEffectiveSalePrice(s, null, plot);
    const houseModel =
      (plot?.house_type_id ? houseTypeMap.get(String(plot.house_type_id)) : undefined) || 'ไม่ระบุ';

    records.push({
      id: `sale-${s.id}`,
      leadId: s.lead_id ? String(s.lead_id) : null,
      saleId: String(s.id),
      name: s.customer_name || s.customerName || 'ลูกค้าไม่ระบุชื่อ',
      project: plot?.project_name || s.project_name || 'Unknown',
      status: isTransferred ? 'Transferred' : isCancelled ? 'Cancelled' : 'Booked',
      stage: isTransferred ? 'transferred' : isCancelled ? 'cancelled' : 'booked',
      isRental: false,
      isBooked,
      isTransferred,
      isCancelledBooking: isCancelled,
      isBankRejected,
      plot: plot?.id || s.plot_id || null,
      plotName: plot?.plot_name || s.plot_id || null,
      salePrice,
      rawSellingPrice: toPositiveNumber(plot?.selling_price ?? plot?.price ?? plot?.base_price),
      landSize: Number(plot?.land_size || 0) || 0,
      houseModel,
      expectedTransferDate: customerBusinessDay(s.expected_transfer_date) || null,
      bookingDate,
      transferDate,
      visitDate: bookingDate,
      agentName: s.agent_name || 'ไม่ระบุ',
      source: s.booking_route === 'legacy_import' ? 'Legacy Import' : 'Walk-in',
      bankStatus: s.bank_status || (isBankRejected ? 'Rejected' : 'Pending'),
      cancelReason,
      created_at: s.created_at || null,
    });
  });

  return records;
}

export function computeSalesIntelligenceMetrics(
  records: SalesIntelligenceRecord[],
  projectsData?: ProjectMeta[]
) {
  // Exclude rental deals from purchase KPIs (count separately)
  const purchaseRecords = records.filter(r => !r.isRental);
  const rentalCount = records.length - purchaseRecords.length;

  const totalVisits = purchaseRecords.length;
  const bookings = purchaseRecords.filter(r => r.isBooked);
  const transfers = purchaseRecords.filter(r => r.isTransferred);
  const cancels = purchaseRecords.filter(r => r.isCancelledBooking);
  const rejects = purchaseRecords.filter(r => r.isBankRejected);

  // Denominator for reject & cancel rate includes all committed purchase deals (active/transferred + cancelled bookings)
  const totalCommittedDeals = bookings.length + cancels.length;
  const rejectRate =
    totalCommittedDeals > 0 ? Math.round((rejects.length / totalCommittedDeals) * 100) : 0;

  const lostRevenue = cancels.reduce((sum, l) => sum + (l.salePrice || l.rawSellingPrice || 0), 0);
  const totalRevenue = transfers.reduce((sum, l) => sum + (l.salePrice || l.rawSellingPrice || 0), 0);

  // 2. Project Positioning Data
  const projectMap: Record<
    string,
    { bookings: number; transfers: number; revenue: number; cancels: number; priceSum: number; pricedCount: number }
  > = {};

  purchaseRecords.forEach(l => {
    const pName = l.project || 'Unknown';
    if (!projectMap[pName]) {
      projectMap[pName] = { bookings: 0, transfers: 0, revenue: 0, cancels: 0, priceSum: 0, pricedCount: 0 };
    }
    const price = l.salePrice || l.rawSellingPrice || 0;

    if (l.isBooked) {
      projectMap[pName].bookings++;
      if (price > 0) {
        projectMap[pName].priceSum += price;
        projectMap[pName].pricedCount++;
      }
    }
    if (l.isTransferred) {
      projectMap[pName].transfers++;
      projectMap[pName].revenue += price;
    }
    if (l.isCancelledBooking) {
      projectMap[pName].cancels++;
    }
  });

  const projectPerformance = Object.entries(projectMap)
    .map(([name, stats]) => {
      const avgPrice = stats.pricedCount > 0 ? stats.priceSum / stats.pricedCount : 0;
      const committed = stats.bookings + stats.cancels;
      const cancelRate = committed > 0 ? Number(((stats.cancels / committed) * 100).toFixed(2)) : 0;
      return {
        name,
        bookings: stats.bookings,
        transfers: stats.transfers,
        revenue: stats.revenue,
        avgPrice,
        cancelRate,
      };
    })
    .filter(p => p.bookings > 0 || p.transfers > 0);

  // 3. Pricing & Preferences (Sweet Spot) — skip unpriced (0) rows so they don't skew "< 2M"
  const priceRanges = {
    '< 2M': 0,
    '2M - 3M': 0,
    '3M - 5M': 0,
    '> 5M': 0,
  };
  bookings.forEach(l => {
    const price = l.salePrice || l.rawSellingPrice || 0;
    if (price <= 0) return;
    if (price < 2000000) priceRanges['< 2M']++;
    else if (price < 3000000) priceRanges['2M - 3M']++;
    else if (price < 5000000) priceRanges['3M - 5M']++;
    else priceRanges['> 5M']++;
  });
  const pricingPreferences = Object.entries(priceRanges).map(([range, count]) => ({ range, count }));

  // 4. Seasonality (sorted chronologically by YYYY-MM)
  const monthBuckets = new Map<string, { sortKey: string; month: string; count: number }>();
  bookings.forEach(l => {
    if (!l.bookingDate) return;
    const date = new Date(l.bookingDate);
    if (Number.isNaN(date.getTime())) return;
    const sortKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const label = date.toLocaleString('en-US', { month: 'short', year: '2-digit' });
    const existing = monthBuckets.get(sortKey);
    if (existing) existing.count++;
    else monthBuckets.set(sortKey, { sortKey, month: label, count: 1 });
  });
  const seasonality = Array.from(monthBuckets.values())
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map(({ month, count }) => ({ month, count }));

  // 5. Cancellations & Risk — use REAL reasons, never fabricate "กู้ไม่ผ่าน" when blank!
  const cancelReasons: Record<string, number> = {};
  cancels.forEach(l => {
    const reason = l.cancelReason?.trim() || 'ไม่ระบุเหตุผล';
    cancelReasons[reason] = (cancelReasons[reason] || 0) + 1;
  });
  const cancellationData = Object.entries(cancelReasons)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // 6. Fastest Selling Plots (Sweet Spot Analysis)
  const plotSales = bookings
    .map(l => {
      let daysToBook = 0;
      if (l.bookingDate && l.visitDate) {
        daysToBook = Math.max(
          0,
          Math.floor((new Date(l.bookingDate).getTime() - new Date(l.visitDate).getTime()) / (1000 * 3600 * 24))
        );
      }
      return {
        plot: l.plotName || l.plot,
        houseModel: l.houseModel,
        landSize: l.landSize,
        price: l.salePrice || l.rawSellingPrice,
        daysToBook,
        status: l.status,
      };
    })
    .filter(p => p.plot && p.houseModel && p.houseModel !== 'ไม่ระบุ');

  plotSales.sort((a, b) => a.daysToBook - b.daysToBook);
  const topFastestSellingPlots = plotSales.slice(0, 10);

  // 7. Sales Velocity & Predictions
  const projectLifecycle: Record<
    string,
    {
      firstBookingDate: number | null;
      transfers: number;
      totalPlots: number;
      transferDates: number[];
    }
  > = {};

  purchaseRecords.forEach(l => {
    const pName = l.project || 'Unknown';
    if (!projectLifecycle[pName]) {
      projectLifecycle[pName] = { firstBookingDate: null, transfers: 0, totalPlots: 0, transferDates: [] };
    }

    if (l.isBooked) {
      projectLifecycle[pName].totalPlots++;
      const refDate = l.bookingDate || l.transferDate;
      if (refDate) {
        const bTime = new Date(refDate).getTime();
        if (!Number.isNaN(bTime) && (!projectLifecycle[pName].firstBookingDate || bTime < projectLifecycle[pName].firstBookingDate)) {
          projectLifecycle[pName].firstBookingDate = bTime;
        }
      }
    }

    if (l.isTransferred) {
      projectLifecycle[pName].transfers++;
      if (l.transferDate) {
        const tTime = new Date(l.transferDate).getTime();
        if (!Number.isNaN(tTime)) {
          projectLifecycle[pName].transferDates.push(tTime);
        }
      }
    }
  });

  const projectPredictions = Object.entries(projectLifecycle)
    .map(([name, p]) => {
      p.transferDates.sort((a, b) => a - b);

      const dbProject = projectsData?.find(proj => proj.name === name);
      const absoluteTotalPlots = dbProject?.plotCount && dbProject.plotCount > 0 ? dbProject.plotCount : p.totalPlots;

      const threshold100 = Math.max(1, absoluteTotalPlots);
      let monthsTo100 = 0;

      const isCompleted = dbProject ? Boolean(dbProject.is_closed) : p.transfers >= threshold100;

      if (p.firstBookingDate && p.transferDates.length > 0 && (isCompleted || p.transfers >= threshold100)) {
        const lastIdx = Math.min(threshold100 - 1, p.transferDates.length - 1);
        const date100 = p.transferDates[lastIdx];
        monthsTo100 = (date100 - p.firstBookingDate) / (1000 * 3600 * 24 * 30.44);
      }

      return {
        name,
        totalPlots: p.totalPlots,
        absoluteTotalPlots,
        transfers: p.transfers,
        firstBookingDate: p.firstBookingDate,
        isCompleted,
        monthsTo100: Math.max(0, monthsTo100),
        predicted100Date: null as number | null,
      };
    })
    .filter(p => p.totalPlots > 0);

  const completedProjects = projectPredictions.filter(p => p.isCompleted && p.monthsTo100 > 0);
  const avgVelocity =
    completedProjects.length > 0
      ? completedProjects.reduce((sum, p) => sum + p.monthsTo100, 0) / completedProjects.length
      : 12;

  projectPredictions.forEach(p => {
    if (!p.isCompleted && p.firstBookingDate) {
      p.predicted100Date = p.firstBookingDate + avgVelocity * 30.44 * 24 * 3600 * 1000;
    }
  });

  return {
    totalVisits,
    bookings: bookings.length,
    transfers: transfers.length,
    cancelledBookings: cancels.length,
    bankRejects: rejects.length,
    rentalDeals: rentalCount,
    rejectRate,
    lostRevenue,
    totalRevenue,
    projectPerformance,
    pricingPreferences,
    seasonality,
    cancellationData,
    topFastestSellingPlots,
    projectPredictions,
    avgVelocity,
  };
}

import { classifySalesDeal, isLegacyPurchaseLeadHolder } from './dealClassification';
import {
  classifyPlotOccupancy,
  type InterestedPlot,
  type PlotOccupancyClassification,
  type PlotRentalContractSnapshot,
  type PlotSaleSnapshot,
} from './plotAvailability';

export interface DashboardRentalStatusResult {
  isRental: boolean;
  isRentalActive: boolean;
  isRentalPending: boolean;
  isRentalEnded: boolean;
  isConvertedToBuy: boolean;
  isPurchase: boolean;
  isConflict: boolean;
  rentalStatus: string | null;
  dealType: string | null;
}

export type DashboardPlotBucket =
  | 'transferred'
  | 'rented'
  | 'waiting'
  | 'priorTransferred'
  | 'available'
  | 'other_occupied'
  | 'skip_unknown_canonical_transfer';

export interface DashboardPlotClassificationResult {
  bucket: DashboardPlotBucket;
  isPendingRental: boolean;
  canonicalOccupancy: PlotOccupancyClassification;
  transferInYear?: any;
  transferPrior?: any;
  waitingSale?: any;
  rentedRecord?: any;
}

const ENDED_CONTRACT_STATUSES = new Set([
  'movedout',
  'cancelled',
  'canceled',
  'convertedtobuy',
  'ended',
  'terminated',
  'expired',
]);

const ACTIVE_CONTRACT_STATUSES = new Set(['active', 'renewed']);
const PENDING_CONTRACT_STATUSES = new Set(['pendingcontract', 'pending_contract']);

const normLower = (v: unknown): string => (typeof v === 'string' ? v.trim().toLowerCase() : '');

export function isSyntheticDashboardLeadRow(record: any): boolean {
  if (!record) return false;
  if (record.isSyntheticLead === true) return true;
  const id = String(record.saleId ?? record.id ?? '');
  return id.startsWith('lead-');
}

/**
 * Finds the active or pending rental contract matching a sale/lead record.
 * Strictly ignores ended/converted rental contracts (MovedOut / Cancelled / ConvertedToBuy)
 * so historical rentals never taint a new purchase buyer on the same plot.
 */
export function findActiveOrPendingRentalContract(
  contracts: readonly any[],
  opts: { customerId?: string | null; plotId?: string | null; plotName?: string | null; projectName?: string | null }
): any | undefined {
  const liveContracts = (contracts || []).filter(c => {
    const st = normLower(c?.status);
    return ACTIVE_CONTRACT_STATUSES.has(st) || PENDING_CONTRACT_STATUSES.has(st);
  });

  if (opts.customerId) {
    const byLead = liveContracts.find(c => c.lead_id && c.lead_id === opts.customerId);
    if (byLead) return byLead;
  }

  return liveContracts.find(
    c =>
      (opts.plotId && c.plot_id === opts.plotId) ||
      (opts.plotName &&
        opts.projectName &&
        c.plot_name === opts.plotName &&
        c.project_name === opts.projectName)
  );
}

/**
 * Classifies whether a dashboard record (real sale or synthetic lead row) belongs
 * to purchase vs rental (active, pending, ended, or converted to buy).
 *
 * Guarantees:
 * - Legacy PendingContract rentals (lead + rental markers, NO rental_contracts row)
 *   are classified as `isRental: true, isRentalPending: true, isPurchase: false`.
 * - ConvertedToBuy deals are classified as `isPurchase: true, isRental: false`.
 * - Ended rental history on a plot never turns a subsequent purchase sale into rental.
 */
export function classifyDashboardRecord(params: {
  record: any;
  matchingLead?: any | null;
  matchingPlot?: any | null;
  matchingLiveContract?: any | null;
  isCancelled: boolean;
  isTransferred: boolean;
}): DashboardRentalStatusResult {
  const { record, matchingLead, matchingPlot, matchingLiveContract, isCancelled, isTransferred } = params;
  const isSynthetic = isSyntheticDashboardLeadRow(record);
  const liveContractStatus = normLower(matchingLiveContract?.status);
  const hasLiveActiveContract = ACTIVE_CONTRACT_STATUSES.has(liveContractStatus);
  const hasLivePendingContract = PENDING_CONTRACT_STATUSES.has(liveContractStatus);

  // Build clean classification input without feeding an ended rental contract or synthetic ID as an active purchase sale
  const deal = classifySalesDeal({
    ...(matchingLead || {}),
    deal_type: record.dealType ?? record.deal_type ?? matchingLead?.deal_type ?? (matchingLiveContract ? 'rent' : null),
    rental_status:
      record.rentalStatus ??
      record.rental_status ??
      matchingLead?.rental_status ??
      matchingLiveContract?.status ??
      null,
    rental_program:
      record.rentalProgram ??
      record.rental_program ??
      matchingLead?.rental_program ??
      matchingLiveContract?.program_type ??
      matchingLiveContract?.rental_program ??
      null,
    status: matchingLead?.status ?? (record.stage === 'rented' ? 'Rented' : record.stage === 'booked' ? 'Reserved' : record.status),
    crm_status: matchingLead?.crm_status ?? record.crm_status ?? null,
    booking_date: record.bookedAt ?? record.bookDate ?? matchingLead?.booking_date ?? null,
    booking_amount: matchingLead?.booking_amount ?? record.booking_amount ?? null,
    saleId: !isSynthetic ? (record.saleId || record.id || null) : null,
    contract_status: !isSynthetic ? (isCancelled ? 'Cancelled' : record.contract_status || (isTransferred ? 'Transferred' : 'Reserved')) : null,
  });

  if (deal.isConvertedToBuy) {
    return {
      isRental: false,
      isRentalActive: false,
      isRentalPending: false,
      isRentalEnded: false,
      isConvertedToBuy: true,
      isPurchase: true,
      isConflict: false,
      rentalStatus: 'ConvertedToBuy',
      dealType: 'buy',
    };
  }

  // Real non-synthetic purchase sale row (not cancelled) without conflicting rental contract
  if (!isSynthetic && !deal.isRentalActive && !deal.isRentalPending && !deal.isConflict && !hasLiveActiveContract && !hasLivePendingContract) {
    return {
      isRental: false,
      isRentalActive: false,
      isRentalPending: false,
      isRentalEnded: false,
      isConvertedToBuy: false,
      isPurchase: true,
      isConflict: false,
      rentalStatus: record.rentalStatus ?? matchingLead?.rental_status ?? null,
      dealType: record.dealType ?? matchingLead?.deal_type ?? 'buy',
    };
  }

  // Check legacy rental markers when synthetic lead lacks structured rental_status
  const leadNotesAndCrm = `${matchingLead?.crm_status || ''} ${matchingLead?.notes || ''} ${record.notes || ''} ${isSynthetic ? (matchingPlot?.highlight_note || '') : ''}`;
  const hasLegacyPendingRentalMarker =
    isSynthetic &&
    !isCancelled &&
    !isTransferred &&
    !deal.isRentalEnded &&
    !deal.isConvertedToBuy &&
    (deal.isRentalPending ||
      hasLivePendingContract ||
      normLower(record.rentalStatus ?? matchingLead?.rental_status) === 'pendingcontract' ||
      /จองเช่า|รอทำสัญญาเช่า|pending[_ -]?contract/i.test(leadNotesAndCrm));

  const isRentalActive =
    !isCancelled &&
    !isTransferred &&
    (deal.isRentalActive || hasLiveActiveContract || record.stage === 'rented');

  const isRentalPending =
    !isCancelled &&
    !isTransferred &&
    !isRentalActive &&
    (deal.isRentalPending || hasLivePendingContract || hasLegacyPendingRentalMarker);

  const isRentalEnded =
    deal.isRentalEnded ||
    (isCancelled &&
      (deal.isRentalPending ||
        deal.isRentalActive ||
        normLower(record.dealType ?? matchingLead?.deal_type) === 'rent' ||
        normLower(record.dealType ?? matchingLead?.deal_type) === 'rent_to_own' ||
        Boolean(record.rentalProgram ?? matchingLead?.rental_program) ||
        Boolean(record.rentalStatus ?? matchingLead?.rental_status) ||
        /จองเช่า|สัญญาเช่า|เช่าออม|เช่าปกติ/i.test(leadNotesAndCrm)));

  const isRental = isRentalActive || isRentalPending || isRentalEnded;

  return {
    isRental,
    isRentalActive,
    isRentalPending,
    isRentalEnded,
    isConvertedToBuy: false,
    isPurchase: !isRental && !deal.isConflict,
    isConflict: deal.isConflict,
    rentalStatus: isRentalActive
      ? (matchingLiveContract?.status || record.rentalStatus || matchingLead?.rental_status || 'Active')
      : isRentalPending
        ? 'PendingContract'
        : isRentalEnded
          ? (record.rentalStatus || matchingLead?.rental_status || 'Cancelled')
          : (record.rentalStatus ?? matchingLead?.rental_status ?? null),
    dealType: isRental
      ? (record.dealType || matchingLead?.deal_type || 'rent')
      : (record.dealType || matchingLead?.deal_type || null),
  };
}

/**
 * Selects the single highest-priority authoritative lead for a plot (if any) to feed
 * into `classifyPlotOccupancy`, strictly ignoring pre-booking inquiry/visit/ended leads
 * unless they represent a real rental holder, legacy purchase holder, or conflict.
 */
export function selectAuthoritativePlotLead(plotLeads: readonly any[]): any | null {
  if (!plotLeads || plotLeads.length === 0) return null;

  let conflictLead: any = null;
  let activeRentalLead: any = null;
  let pendingRentalLead: any = null;
  let legacyPurchaseLead: any = null;

  for (const lead of plotLeads) {
    const deal = classifySalesDeal(lead);
    if (deal.isConflict && !conflictLead) {
      conflictLead = lead;
    } else if (deal.isRentalActive && !activeRentalLead) {
      activeRentalLead = lead;
    } else if (deal.isRentalPending && !pendingRentalLead) {
      pendingRentalLead = lead;
    } else if (isLegacyPurchaseLeadHolder(lead) && !legacyPurchaseLead) {
      legacyPurchaseLead = lead;
    }
  }

  return conflictLead || activeRentalLead || pendingRentalLead || legacyPurchaseLead || null;
}

/**
 * Classifies a plot into its exact Dashboard project-group bucket while:
 * 1. NEVER passing synthetic rental leads as purchase `sales` into `classifyPlotOccupancy`!
 * 2. Supporting legacy PendingContract rentals (lead + rental markers, no contract row)
 *    so they count in `rented` (with `isPendingRental: true`) — never lost, never `available`,
 *    never miscounted as purchase `waiting`!
 * 3. Preventing double-counting when both a lead and a rental_contract exist.
 * 4. Preserving exact year/date filters (`selectedYear`, `targetDateStr`) and purchase sales totals.
 */
export function classifyDashboardPlotBucket(params: {
  plot: Partial<InterestedPlot> & { id: string; project_name?: string | null; plot_name?: string | null };
  plotRecords: readonly any[];
  plotContracts: readonly any[];
  plotLeads?: readonly any[];
  selectedYear: string;
  targetDateStr: string;
  isCanonical: boolean;
}): DashboardPlotClassificationResult {
  const { plot, plotRecords, plotContracts, plotLeads = [], selectedYear, targetDateStr, isCanonical } = params;

  // Separate real purchase sales from synthetic/rental rows BEFORE calling classifyPlotOccupancy!
  const purchaseRecords = plotRecords.filter(r => !r.isRental && !r.isConflict);
  const realPurchaseSales: PlotSaleSnapshot[] = purchaseRecords
    .filter(r => !isSyntheticDashboardLeadRow(r))
    .map(s => ({
      id: s.saleId || s.id,
      plot_id: plot.id,
      stage: s.stage,
      contract_status: s.status,
    }));

  const rentalContractSnapshots: PlotRentalContractSnapshot[] = plotContracts.map(c => ({
    id: c.id,
    plot_id: plot.id,
    status: c.status,
  }));

  const authoritativeLead = selectAuthoritativePlotLead(plotLeads);

  // If a synthetic non-rental legacy purchase lead exists (not already covered by plotLeads), keep it visible as lead,
  // NEVER pass synthetic rental leads as purchase `sales`!
  const occupancyLead =
    authoritativeLead ||
    (() => {
      const rentalRec = plotRecords.find(r => r.isRental && !r.isRentalEnded && r.stage !== 'cancelled');
      if (rentalRec) {
        return {
          id: rentalRec.customerId || rentalRec.id,
          deal_type: rentalRec.dealType || 'rent',
          rental_status: rentalRec.isRentalActive ? 'Active' : rentalRec.isRentalPending ? 'PendingContract' : rentalRec.rentalStatus,
          status: rentalRec.isRentalActive ? 'Rented' : 'Reserved',
          rental_program: rentalRec.rentalProgram || null,
        };
      }
      const synthPurchase = purchaseRecords.find(r => isSyntheticDashboardLeadRow(r) && r.stage !== 'cancelled');
      if (synthPurchase) {
        return {
          id: synthPurchase.customerId || synthPurchase.id,
          deal_type: 'buy',
          status: ['transferred', 'handover'].includes(normLower(synthPurchase.stage || synthPurchase.status))
            ? 'Transferred'
            : 'Reserved',
          transferred_date: synthPurchase.transferDate || null,
        };
      }
      return null;
    })();

  const canonicalOccupancy = classifyPlotOccupancy({
    plot,
    sales: realPurchaseSales,
    rentalContracts: rentalContractSnapshots,
    lead: occupancyLead,
  });

  // 1. Purchase sale transferred in selectedYear (up to targetDateStr)
  const transferInYear = purchaseRecords.find(
    s =>
      ['transferred', 'handover'].includes(normLower(s.stage || s.status)) &&
      s.transferDate &&
      s.transferDate.startsWith(selectedYear) &&
      s.transferDate <= targetDateStr
  );

  // 2. Purchase sale transferred in a prior year (< selectedYear-01-01)
  const transferPrior = purchaseRecords.find(
    s =>
      ['transferred', 'handover'].includes(normLower(s.stage || s.status)) &&
      s.transferDate &&
      s.transferDate < `${selectedYear}-01-01`
  );

  if (
    isCanonical &&
    purchaseRecords.some(s => ['transferred', 'handover'].includes(s.stage) && !s.transferDate) &&
    !transferInYear &&
    !transferPrior
  ) {
    return {
      bucket: 'skip_unknown_canonical_transfer',
      isPendingRental: false,
      canonicalOccupancy,
    };
  }

  if (transferInYear) {
    return {
      bucket: 'transferred',
      isPendingRental: false,
      canonicalOccupancy,
      transferInYear,
    };
  }

  // Active rental (contract, record, or canonical occupancy)
  const hasLiveActiveContract = plotContracts.some(c => ACTIVE_CONTRACT_STATUSES.has(normLower(c.status)));
  const activeRentalRecord = plotRecords.find(
    s =>
      s.isRental &&
      s.stage !== 'cancelled' &&
      s.status !== 'Cancelled' &&
      (s.isRentalActive ||
        s.isRentalContracted ||
        ACTIVE_CONTRACT_STATUSES.has(normLower(s.rentalStatus)) ||
        normLower(s.stage) === 'rented' ||
        normLower(s.status) === 'rented')
  );
  const isPlotRentedActive =
    hasLiveActiveContract ||
    Boolean(activeRentalRecord) ||
    canonicalOccupancy.status === 'rental_active';

  // Pending rental (contract, legacy PendingContract lead/record without contract row, or canonical occupancy)
  const hasLivePendingContract = plotContracts.some(c => PENDING_CONTRACT_STATUSES.has(normLower(c.status)));
  const pendingRentalRecord = plotRecords.find(
    s =>
      s.isRental &&
      !s.isRentalEnded &&
      s.stage !== 'cancelled' &&
      s.status !== 'Cancelled' &&
      (s.isRentalPending || PENDING_CONTRACT_STATUSES.has(normLower(s.rentalStatus))) &&
      (!s.bookDate || s.bookDate <= targetDateStr) &&
      (!s.cancelDate || s.cancelDate > targetDateStr)
  );
  const isPlotPendingRental =
    !isPlotRentedActive &&
    (hasLivePendingContract ||
      Boolean(pendingRentalRecord) ||
      canonicalOccupancy.status === 'rental_pending');

  if (isPlotRentedActive || isPlotPendingRental) {
    return {
      bucket: 'rented',
      isPendingRental: isPlotPendingRental,
      canonicalOccupancy,
      rentedRecord: activeRentalRecord || pendingRentalRecord || plotRecords.find(s => s.isRental),
    };
  }

  // 3. Active waiting purchase sale (strictly excludes rentals!)
  const waitingSale = purchaseRecords.find(
    s =>
      s.stage !== 'cancelled' &&
      s.status !== 'Cancelled' &&
      !['transferred', 'handover'].includes(normLower(s.stage || s.status)) &&
      (!s.bookDate || s.bookDate <= targetDateStr) &&
      (!s.cancelDate || s.cancelDate > targetDateStr)
  );

  const plotSaleStatusLower = normLower(plot.sale_status);
  if (
    waitingSale ||
    (!isCanonical &&
      !transferPrior &&
      !canonicalOccupancy.isConflictOrUnknown &&
      ['booked', 'contracted', 'reserved'].includes(plotSaleStatusLower))
  ) {
    return {
      bucket: 'waiting',
      isPendingRental: false,
      canonicalOccupancy,
      waitingSale:
        waitingSale ||
        purchaseRecords.find(s => s.stage !== 'cancelled' && s.status !== 'Cancelled'),
    };
  }

  if (transferPrior || (!isCanonical && plotSaleStatusLower === 'transferred')) {
    return {
      bucket: 'priorTransferred',
      isPendingRental: false,
      canonicalOccupancy,
      transferPrior:
        transferPrior ||
        purchaseRecords.find(s => ['transferred', 'handover'].includes(normLower(s.stage || s.status))),
    };
  }

  if (canonicalOccupancy.isAvailable) {
    return {
      bucket: 'available',
      isPendingRental: false,
      canonicalOccupancy,
    };
  }

  return {
    bucket: 'other_occupied',
    isPendingRental: false,
    canonicalOccupancy,
  };
}

/**
 * Deduplicates booking records across real sales, synthetic leads, and orphan rental_contracts
 * so a PendingContract / Active rental that exists in BOTH `leads` and `rental_contracts`
 * is counted strictly ONCE (never double-counted), while legacy PendingContract leads with
 * NO `rental_contracts` row and orphan contracts with NO `leads` row are both preserved.
 */
export function appendDeduplicatedOrphanRentalRecords(
  existingRecords: readonly any[],
  rentalContracts: readonly any[],
  plots: readonly any[]
): any[] {
  const result = [...existingRecords];
  const existingLeadIds = new Set(
    existingRecords
      .filter(r => r.isRental && r.stage !== 'cancelled')
      .map(r => r.customerId || r.sale?.customerId)
      .filter(Boolean)
  );
  const existingRentalPlotIds = new Set(
    existingRecords
      .filter(r => r.isRental && r.stage !== 'cancelled')
      .map(r => r.plot_id || r.plot?.id)
      .filter(Boolean)
  );

  for (const rc of rentalContracts || []) {
    const st = normLower(rc?.status);
    if (ENDED_CONTRACT_STATUSES.has(st)) continue;
    const isActive = ACTIVE_CONTRACT_STATUSES.has(st);
    const isPending = PENDING_CONTRACT_STATUSES.has(st);
    if (!isActive && !isPending) continue;

    if (rc.lead_id && existingLeadIds.has(rc.lead_id)) continue;
    if (rc.plot_id && existingRentalPlotIds.has(rc.plot_id)) continue;

    const matchedPlot = (plots || []).find(
      p => p.id === rc.plot_id || (rc.project_name && p.project_name === rc.project_name && p.plot_name === rc.plot_name)
    );
    const plotId = matchedPlot?.id || rc.plot_id || null;
    const bookDate =
      rc.booking_date?.split('T')[0] ||
      rc.created_at?.split('T')[0] ||
      rc.lease_start_date?.split('T')[0] ||
      null;
    const price = Number(rc.base_price || matchedPlot?.selling_price || 0);
    const appraisal = Number(matchedPlot?.land_appraisal_price || 0) || price;

    if (rc.lead_id) existingLeadIds.add(rc.lead_id);
    if (plotId) existingRentalPlotIds.add(plotId);

    result.push({
      id: `rental-contract-${rc.id}`,
      saleId: `rental-contract-${rc.id}`,
      customerId: rc.lead_id || null,
      isSyntheticLead: true,
      plot_id: plotId,
      plot_name: matchedPlot?.plot_name || rc.plot_name || plotId,
      project_name: rc.project_name || matchedPlot?.project_name || 'ไม่ระบุโครงการ',
      customer_name: rc.tenant_name || 'ผู้เช่าไม่ระบุชื่อ',
      phone: rc.tenant_phone || '-',
      agent_name: rc.agent_name || '-',
      salePrice: price,
      tdPrice: appraisal,
      status: isActive ? 'Rented' : 'Reserved',
      statusLabel: isActive ? 'ทำสัญญาแล้ว' : 'จองเช่า',
      stage: isActive ? 'rented' : 'booked',
      bookDate,
      transferDate: null,
      cancelDate: null,
      createdDate: bookDate || '2025-01-01',
      expectedTransfer: null,
      expectedTransferDate: null,
      dealType: 'rent',
      rentalProgram: rc.program_type || rc.rental_program || null,
      rentalStatus: isActive ? 'Active' : 'PendingContract',
      rentalStartDate: rc.lease_start_date?.split('T')[0] || null,
      contractDate: rc.created_at?.split('T')[0] || null,
      isRental: true,
      isRentalActive: isActive,
      isRentalPending: isPending,
      isRentalEnded: false,
      isRentalContracted: isActive,
      isPurchase: false,
      isConflict: false,
      plot: matchedPlot || { id: plotId, plot_name: rc.plot_name || plotId, project_name: rc.project_name, selling_price: price, land_appraisal_price: appraisal },
      sale: {
        saleId: `rental-contract-${rc.id}`,
        customerId: rc.lead_id || null,
        isSyntheticLead: true,
        stage: isActive ? 'rented' : 'booked',
        tdPrice: appraisal,
        dealType: 'rent',
        rentalProgram: rc.program_type || rc.rental_program || null,
        rentalStatus: isActive ? 'Active' : 'PendingContract',
        rentalStartDate: rc.lease_start_date?.split('T')[0] || null,
        isRental: true,
        isRentalContracted: isActive,
      },
    });
  }

  return result;
}

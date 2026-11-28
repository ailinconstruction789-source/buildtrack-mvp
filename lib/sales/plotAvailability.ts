import { classifySalesDeal, isLegacyPurchaseLeadHolder } from './dealClassification';
import { getLeadStage } from './leadStage';
import { salesDealStageOf } from './dealStatus';

/** Legacy-compatible stock reads. An expression of interest never reserves stock. */
export interface InterestedPlot {
  id: string;
  plot_name: string | null;
  project_name: string;
  has_customer: boolean | null;
  sale_status: string | null;
  current_tenant_name?: string | null;
  rental_program?: string | null;
  lease_start_date?: string | null;
  highlight_note?: string | null;
  /** Optional non-PII flag projected by server readers when legacy rental metadata is present */
  has_legacy_rental_metadata?: boolean | null;
}

export interface PlotSaleSnapshot {
  id?: string | null;
  plot_id: string | null;
  contract_status?: string | null;
  crm_stage?: string | null;
  stage?: string | null;
}

export interface PlotRentalContractSnapshot {
  id?: string | null;
  plot_id: string | null;
  status?: string | null;
}

export interface PlotLeadOccupancyInput {
  id?: string | null;
  status?: string | null;
  crm_status?: string | null;
  deal_type?: string | null;
  rental_status?: string | null;
  active_rental_contract_id?: string | null;
  transferred_date?: string | null;
  transferredDate?: string | null;
  transferred_at?: string | null;
  stage?: string | null;
  [key: string]: unknown;
}

export type CanonicalPlotOccupancyStatus =
  | 'available'
  | 'purchase_booked'
  | 'purchase_transferred'
  | 'rental_pending'
  | 'rental_active'
  | 'occupied_restricted'
  | 'unknown';

export interface PlotOccupancyClassification {
  status: CanonicalPlotOccupancyStatus;
  /** True ONLY when plot is verified vacant across plot flags, sales, rental contracts, and lead state */
  isAvailable: boolean;
  /** True when an active buyer, tenant, pending rental booking, or non-vacant plot flag holds the plot */
  isOccupied: boolean;
  /** True when records conflict, status is unrecognized, or required occupancy data is incomplete */
  isConflictOrUnknown: boolean;
  /** Non-PII reason code explaining why this classification was produced */
  reasonCode: string;
}

export interface ClassifyPlotOccupancyInput {
  plot?: Partial<InterestedPlot> | null;
  sales?: readonly PlotSaleSnapshot[];
  rentalContracts?: readonly PlotRentalContractSnapshot[];
  lead?: PlotLeadOccupancyInput | null;
  /** Set true if any authoritative upstream query failed or returned truncated data */
  readIncomplete?: boolean;
}

// `active` means construction is active, NOT that the plot has a buyer.
// Unknown status values are withheld for review, not silently treated as vacant.
export const VACANT_PLOT_SALE_STATUSES = new Set([
  '',
  'active',
  'normal',
  'ready_for_sale',
  'available',
  'vacant',
]);

export const TRANSFERRED_PLOT_SALE_STATUSES = new Set([
  'transferred',
  'sold',
  'handover',
]);

export const RESERVED_PLOT_SALE_STATUSES = new Set([
  'reserved',
  'booked',
  'contracted',
  'downpayment',
  'documentprep',
  'loanprocessing',
  'approved',
  'transferpending',
]);

const ENDED_RENTAL_CONTRACT_STATUSES = new Set([
  'movedout',
  'cancelled',
  'convertedtobuy',
  'ended',
  'converted',
  'terminated',
]);

const PENDING_RENTAL_CONTRACT_STATUSES = new Set([
  'pendingcontract',
  'pending_contract',
]);

const ACTIVE_RENTAL_CONTRACT_STATUSES = new Set([
  'active',
  'renewed',
]);

function normLower(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function plotHasLegacyRentalMetadata(plot?: Partial<InterestedPlot> | null): boolean {
  if (!plot) return false;
  return Boolean(
    plot.has_legacy_rental_metadata === true ||
      hasText(plot.current_tenant_name) ||
      hasText(plot.rental_program) ||
      hasText(plot.lease_start_date)
  );
}

export function isSaleSnapshotActive(sale: PlotSaleSnapshot): boolean {
  const effective = normLower(sale.stage ?? sale.crm_stage ?? sale.contract_status) || 'unknown';
  return effective !== 'cancelled';
}

export function isSaleSnapshotTransferred(sale: PlotSaleSnapshot): boolean {
  const effective = normLower(sale.stage ?? sale.crm_stage ?? sale.contract_status);
  return effective === 'transferred' || effective === 'handover';
}

/**
 * Single canonical plot occupancy classifier shared across:
 * - Available plot pickers (`filterAvailablePlots`, `loadAvailablePlots`)
 * - Legacy Project Map (`SalesMap`, `SalesKanban`)
 * - Central V2 Project Map (`projectMapContracts`, `projectSalesServer`)
 * - Dashboards & summaries (`SalesDashboardExcelStyle`, `SalesSummaryTable`)
 *
 * Guarantees:
 * 1. Never treats absence of a loaded lead as evidence of vacancy.
 * 2. Recognizes purchase bookings/transfers, PendingContract rental bookings,
 *    Active/Renewed rentals, and legacy plot occupancy metadata.
 * 3. Preserves non-vacant status when RLS hides customer/lead details (`occupied_restricted`)
 *    without exposing any customer PII.
 * 4. Fails closed to `unknown` (`isAvailable: false`) on missing plots, incomplete reads,
 *    null `has_customer`, unrecognized statuses, or conflicting purchase/rental state.
 */
export function classifyPlotOccupancy(
  input: ClassifyPlotOccupancyInput
): PlotOccupancyClassification {
  const { plot, sales = [], rentalContracts = [], lead = null, readIncomplete = false } = input;

  if (readIncomplete || !plot || !hasText(plot.id)) {
    return {
      status: 'unknown',
      isAvailable: false,
      isOccupied: false,
      isConflictOrUnknown: true,
      reasonCode: readIncomplete ? 'INCOMPLETE_READ' : 'MISSING_PLOT',
    };
  }

  const plotId = plot.id!;
  const saleStatusLower = normLower(plot.sale_status);
  const isVacantSaleStatus = VACANT_PLOT_SALE_STATUSES.has(saleStatusLower);
  const isTransferredSaleStatus = TRANSFERRED_PLOT_SALE_STATUSES.has(saleStatusLower);
  const isReservedSaleStatus = RESERVED_PLOT_SALE_STATUSES.has(saleStatusLower);
  const isRentedSaleStatus = saleStatusLower === 'rented';
  const isUnknownSaleStatus =
    !isVacantSaleStatus && !isTransferredSaleStatus && !isReservedSaleStatus && !isRentedSaleStatus;

  const hasLegacyRental = plotHasLegacyRentalMetadata(plot);
  const isPendingRentalHint =
    !hasText(plot.lease_start_date) &&
    !isRentedSaleStatus &&
    typeof plot.highlight_note === 'string' &&
    plot.highlight_note.trim().startsWith('จองเช่า:');

  const matchingSales = sales.filter(s => !s.plot_id || s.plot_id === plotId);
  const activeSales = matchingSales.filter(isSaleSnapshotActive);

  const matchingContracts = rentalContracts.filter(c => !c.plot_id || c.plot_id === plotId);
  const pendingContracts: PlotRentalContractSnapshot[] = [];
  const activeContracts: PlotRentalContractSnapshot[] = [];
  const unknownContracts: PlotRentalContractSnapshot[] = [];

  for (const rc of matchingContracts) {
    const st = normLower(rc.status);
    if (PENDING_RENTAL_CONTRACT_STATUSES.has(st)) {
      pendingContracts.push(rc);
    } else if (ACTIVE_RENTAL_CONTRACT_STATUSES.has(st)) {
      activeContracts.push(rc);
    } else if (!ENDED_RENTAL_CONTRACT_STATUSES.has(st)) {
      unknownContracts.push(rc);
    }
  }

  const leadDeal = lead ? classifySalesDeal(lead) : null;
  const leadStage = lead ? getLeadStage(lead) : null;
  // Use canonical purchase-commitment evidence (strictly excludes pre-booking inquiry/visit/pre-approval
  // stages where getLeadStage returns 'active' | 'appointment' | 'loan', while preserving committed
  // post-booking legacy purchase holders like Reserved/Booked/Contracted/LoanProcessing/Approved/Transferred).
  const leadIsActivePurchase = Boolean(
    lead &&
      leadDeal?.isPurchaseFlow &&
      !leadDeal.isConflict &&
      isLegacyPurchaseLeadHolder(lead) &&
      (leadStage === 'booked' || leadStage === 'transferred')
  );
  const leadHasTransferEvidence = Boolean(
    leadIsActivePurchase &&
      lead &&
      (leadStage === 'transferred' ||
        normLower(lead.status) === 'transferred' ||
        normLower(lead.status) === 'handover' ||
        hasText(lead.transferredDate) ||
        hasText(lead.transferred_date) ||
        hasText(lead.transferred_at))
  );

  const totalRentalContracts = pendingContracts.length + activeContracts.length;

  // 1. Hard conflicts or unrecognized statuses -> ALWAYS unknown (never available)
  if (unknownContracts.length > 0) {
    return {
      status: 'unknown',
      isAvailable: false,
      isOccupied: false,
      isConflictOrUnknown: true,
      reasonCode: 'UNKNOWN_RENTAL_CONTRACT_STATUS',
    };
  }

  if (leadDeal?.isConflict) {
    return {
      status: 'unknown',
      isAvailable: false,
      isOccupied: false,
      isConflictOrUnknown: true,
      reasonCode: 'CONFLICTING_LEAD_STATE',
    };
  }

  if (activeSales.length > 1 || totalRentalContracts > 1) {
    return {
      status: 'unknown',
      isAvailable: false,
      isOccupied: false,
      isConflictOrUnknown: true,
      reasonCode: 'MULTIPLE_ACTIVE_HOLDERS',
    };
  }

  if (
    activeSales.length > 0 &&
    (totalRentalContracts > 0 || leadDeal?.isRentalPending || leadDeal?.isRentalActive)
  ) {
    return {
      status: 'unknown',
      isAvailable: false,
      isOccupied: false,
      isConflictOrUnknown: true,
      reasonCode: 'PURCHASE_AND_RENTAL_CONFLICT',
    };
  }

  if (
    isTransferredSaleStatus &&
    (totalRentalContracts > 0 || leadDeal?.isRentalPending || leadDeal?.isRentalActive || hasLegacyRental)
  ) {
    return {
      status: 'unknown',
      isAvailable: false,
      isOccupied: false,
      isConflictOrUnknown: true,
      reasonCode: 'TRANSFERRED_WITH_RENTAL_CONFLICT',
    };
  }

  if (isUnknownSaleStatus) {
    return {
      status: 'unknown',
      isAvailable: false,
      isOccupied: false,
      isConflictOrUnknown: true,
      reasonCode: 'UNKNOWN_PLOT_SALE_STATUS',
    };
  }

  // 2. Authoritative purchase holder (from sales table or visible purchase lead)
  if (activeSales.length === 1) {
    const sale = activeSales[0];
    if (isSaleSnapshotTransferred(sale) || isTransferredSaleStatus || leadHasTransferEvidence) {
      return {
        status: 'purchase_transferred',
        isAvailable: false,
        isOccupied: true,
        isConflictOrUnknown: false,
        reasonCode: 'ACTIVE_SALE_TRANSFERRED',
      };
    }
    return {
      status: 'purchase_booked',
      isAvailable: false,
      isOccupied: true,
      isConflictOrUnknown: false,
      reasonCode: 'ACTIVE_SALE_BOOKED',
    };
  }

  // 3. Authoritative rental holder (Active/Renewed takes precedence over PendingContract)
  if (activeContracts.length === 1 || leadDeal?.isRentalActive) {
    return {
      status: 'rental_active',
      isAvailable: false,
      isOccupied: true,
      isConflictOrUnknown: false,
      reasonCode: activeContracts.length === 1 ? 'ACTIVE_RENTAL_CONTRACT' : 'ACTIVE_RENTAL_LEAD',
    };
  }

  if (pendingContracts.length === 1 || leadDeal?.isRentalPending) {
    return {
      status: 'rental_pending',
      isAvailable: false,
      isOccupied: true,
      isConflictOrUnknown: false,
      reasonCode: pendingContracts.length === 1 ? 'PENDING_RENTAL_CONTRACT' : 'PENDING_RENTAL_LEAD',
    };
  }

  // 4. Visible purchase lead without sales row (legacy native lead)
  if (leadIsActivePurchase) {
    if (leadHasTransferEvidence || salesDealStageOf(lead!) === 'transferred' || salesDealStageOf(lead!) === 'handover') {
      return {
        status: 'purchase_transferred',
        isAvailable: false,
        isOccupied: true,
        isConflictOrUnknown: false,
        reasonCode: 'LEAD_PURCHASE_TRANSFERRED',
      };
    }
    return {
      status: 'purchase_booked',
      isAvailable: false,
      isOccupied: true,
      isConflictOrUnknown: false,
      reasonCode: 'LEAD_PURCHASE_BOOKED',
    };
  }

  // 5. No visible lead/sale/contract (e.g., RLS restricted or legacy plot-only state):
  //    NEVER treat missing lead as vacant — obey authoritative plot flags!
  if (isTransferredSaleStatus) {
    return {
      status: 'purchase_transferred',
      isAvailable: false,
      isOccupied: true,
      isConflictOrUnknown: false,
      reasonCode: 'PLOT_FLAG_TRANSFERRED',
    };
  }

  if (isRentedSaleStatus) {
    return {
      status: 'rental_active',
      isAvailable: false,
      isOccupied: true,
      isConflictOrUnknown: false,
      reasonCode: 'PLOT_FLAG_RENTED',
    };
  }

  if (hasLegacyRental) {
    return {
      status: isPendingRentalHint ? 'rental_pending' : 'rental_active',
      isAvailable: false,
      isOccupied: true,
      isConflictOrUnknown: false,
      reasonCode: isPendingRentalHint ? 'PLOT_LEGACY_RENTAL_PENDING' : 'PLOT_LEGACY_RENTAL_OCCUPIED',
    };
  }

  if (isReservedSaleStatus) {
    return {
      status: isPendingRentalHint ? 'rental_pending' : 'occupied_restricted',
      isAvailable: false,
      isOccupied: true,
      isConflictOrUnknown: false,
      reasonCode: isPendingRentalHint ? 'PLOT_FLAG_RENTAL_RESERVED' : 'PLOT_FLAG_RESERVED',
    };
  }

  if (plot.has_customer === true) {
    return {
      status: 'occupied_restricted',
      isAvailable: false,
      isOccupied: true,
      isConflictOrUnknown: false,
      reasonCode: 'PLOT_HAS_CUSTOMER_FLAG',
    };
  }

  // Null/undefined has_customer -> unknown, NEVER silently available!
  if (plot.has_customer !== false) {
    return {
      status: 'unknown',
      isAvailable: false,
      isOccupied: false,
      isConflictOrUnknown: true,
      reasonCode: 'NULL_HAS_CUSTOMER_FLAG',
    };
  }

  return {
    status: 'available',
    isAvailable: true,
    isOccupied: false,
    isConflictOrUnknown: false,
    reasonCode: 'VERIFIED_VACANT',
  };
}

export function filterAvailablePlots(
  plots: readonly InterestedPlot[],
  sales: readonly PlotSaleSnapshot[],
  projectName: string,
  rentalContracts: readonly PlotRentalContractSnapshot[] = [],
): InterestedPlot[] {
  if (!projectName || projectName === 'all') return [];

  const salesByPlot = new Map<string, PlotSaleSnapshot[]>();
  for (const sale of sales) {
    if (!sale.plot_id) continue;
    const list = salesByPlot.get(sale.plot_id);
    if (list) list.push(sale);
    else salesByPlot.set(sale.plot_id, [sale]);
  }

  const rentalsByPlot = new Map<string, PlotRentalContractSnapshot[]>();
  for (const rc of rentalContracts) {
    if (!rc.plot_id) continue;
    const list = rentalsByPlot.get(rc.plot_id);
    if (list) list.push(rc);
    else rentalsByPlot.set(rc.plot_id, [rc]);
  }

  return plots
    .filter(plot => {
      if (plot.project_name !== projectName) return false;
      const classification = classifyPlotOccupancy({
        plot,
        sales: salesByPlot.get(plot.id) ?? [],
        rentalContracts: rentalsByPlot.get(plot.id) ?? [],
      });
      return classification.isAvailable;
    })
    .sort((a, b) => (a.plot_name || a.id).localeCompare(b.plot_name || b.id, 'th', { numeric: true }));
}

export function searchAvailablePlots(plots: readonly InterestedPlot[], search: string): InterestedPlot[] {
  const query = search.trim().toLocaleLowerCase();
  return plots.filter(plot => !query || `${plot.plot_name ?? ''} ${plot.id}`.toLocaleLowerCase().includes(query));
}

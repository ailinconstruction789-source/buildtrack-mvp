import {
  classifySalesDeal,
  isLegacyPurchaseLeadHolder,
  matchLeadPlotReference,
} from './dealClassification';

export interface ReconciliationPlotRow {
  id: string;
  project_name?: string | null;
  plot_name?: string | null;
  has_customer?: boolean | null;
  sale_status?: string | null;
  current_tenant_name?: string | null;
  current_tenant_phone?: string | null;
  rental_program?: string | null;
  monthly_rent?: number | null;
  security_deposit?: number | null;
  lease_start_date?: string | null;
  lease_end_date?: string | null;
  highlight_note?: string | null;
}

export interface ReconciliationSaleRow {
  id: string;
  lead_id?: string | null;
  plot_id?: string | null;
  contract_status?: string | null;
  crm_stage?: string | null;
}

export interface ReconciliationRentalContractRow {
  id: string;
  lead_id?: string | null;
  plot_id?: string | null;
  project_name?: string | null;
  tenant_name?: string | null;
  status?: string | null;
}

export interface ReconciliationLeadRow {
  id: string;
  project_name?: string | null;
  customer_name?: string | null;
  status?: string | null;
  crm_status?: string | null;
  deal_type?: string | null;
  rental_status?: string | null;
  active_rental_contract_id?: string | null;
  interested_plot_id?: string | null;
  interested_plot_name?: string | null;
}

export interface ReconciliationSnapshot {
  plots: ReconciliationPlotRow[];
  sales: ReconciliationSaleRow[];
  rentalContracts: ReconciliationRentalContractRow[];
  leads: ReconciliationLeadRow[];
}

export type ReconciliationCategory =
  | 'consistent'
  | 'safe_legacy_plot_release'
  | 'safe_stock_sync_occupied'
  | 'manual_review_ambiguous';

export interface ReconciliationPlotFinding {
  category: ReconciliationCategory;
  plotId: string;
  plotName: string;
  projectName: string;
  currentHasCustomer: boolean;
  currentSaleStatus: string;
  hasRentalMetadata: boolean;
  reasonCode: string;
  reason: string;
  recommendedCommand:
    | 'none'
    | 'sales_tx_release_legacy_plot'
    | 'sync_occupied_stock'
    | 'manual_inspection_required';
  evidence: {
    activeSaleIds: string[];
    activePurchaseLeadIds: string[];
    activeOrPendingContractIds: string[];
    activeOrPendingRentalLeadIds: string[];
    ambiguousReferenceLeadIds: string[];
    endedHistoryIds: string[];
    unknownStatusContractIds: string[];
  };
  /** Pre-filled audited payload for single-plot RPC remediation (only for safe_legacy_plot_release) */
  suggestedReleasePayload?: {
    projectName: string;
    plotId: string;
    expectedHasCustomer: boolean;
    expectedSaleStatus: string;
    reason: string;
  };
}

export interface ReconciliationLeadFinding {
  leadId: string;
  customerName: string;
  projectName: string;
  plotId: string | null;
  reasonCode: string;
  reason: string;
}

export interface RentalReconciliationDryRunReport {
  mode: 'read_only_dry_run';
  generatedAt: string;
  summary: {
    totalPlots: number;
    consistentPlots: number;
    safeLegacyPlotReleaseCount: number;
    safeStockSyncOccupiedCount: number;
    manualReviewAmbiguousCount: number;
    manualReviewLeadCount: number;
  };
  safeToReleaseLegacyPlots: ReconciliationPlotFinding[];
  safeToSyncOccupiedPlots: ReconciliationPlotFinding[];
  needsManualReviewPlots: ReconciliationPlotFinding[];
  needsManualReviewLeads: ReconciliationLeadFinding[];
}

const VACANT_PLOT_STATUSES = new Set([
  '',
  'active',
  'normal',
  'ready_for_sale',
  'available',
  'vacant',
]);

const TRANSFERRED_PLOT_STATUSES = new Set([
  'transferred',
  'sold',
  'handover',
]);

const NON_ACTIVE_CONTRACT_STATUSES = new Set([
  'MovedOut',
  'Cancelled',
  'ConvertedToBuy',
]);

// Only MovedOut / Cancelled represent vacating rental endings; ConvertedToBuy means customer is buying!
const VACATING_ENDED_CONTRACT_STATUSES = new Set([
  'MovedOut',
  'Cancelled',
]);

const KNOWN_ACTIVE_CONTRACT_STATUSES = new Set([
  'PendingContract',
  'Active',
  'Renewed',
]);

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLower(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function isSaleActive(sale: ReconciliationSaleRow): boolean {
  const stage = normalizeLower(sale.crm_stage);
  const contractStatus = normalizeLower(sale.contract_status);
  const effective = stage || contractStatus || 'unknown';
  return effective !== 'cancelled';
}

function hasAnyRentalMetadata(plot: ReconciliationPlotRow): boolean {
  const highlight = normalizeText(plot.highlight_note);
  const hasRentalHighlight = highlight.startsWith('จองเช่า:') || highlight.startsWith('เช่า:');
  return Boolean(
    normalizeText(plot.current_tenant_name) ||
      normalizeText(plot.current_tenant_phone) ||
      normalizeText(plot.rental_program) ||
      (plot.monthly_rent !== null && plot.monthly_rent !== undefined && Number(plot.monthly_rent) !== 0) ||
      (plot.security_deposit !== null && plot.security_deposit !== undefined && Number(plot.security_deposit) !== 0) ||
      normalizeText(plot.lease_start_date) ||
      normalizeText(plot.lease_end_date) ||
      hasRentalHighlight
  );
}

/**
 * Pure read-only / dry-run reconciliation classifier.
 * Never mutates data or executes blanket resets.
 * Separates safely fixable legacy plots from ambiguous/conflicting records with explicit reasons.
 */
export function buildRentalReconciliationDryRunReport(
  snapshot: ReconciliationSnapshot
): RentalReconciliationDryRunReport {
  const plots = snapshot.plots || [];
  const sales = snapshot.sales || [];
  const rentalContracts = snapshot.rentalContracts || [];
  const leads = snapshot.leads || [];

  const salesByPlot = new Map<string, ReconciliationSaleRow[]>();
  for (const s of sales) {
    if (!s.plot_id) continue;
    const arr = salesByPlot.get(s.plot_id) || [];
    arr.push(s);
    salesByPlot.set(s.plot_id, arr);
  }

  const contractsByPlot = new Map<string, ReconciliationRentalContractRow[]>();
  const contractsByLead = new Map<string, ReconciliationRentalContractRow[]>();
  for (const rc of rentalContracts) {
    if (rc.plot_id) {
      const arr = contractsByPlot.get(rc.plot_id) || [];
      arr.push(rc);
      contractsByPlot.set(rc.plot_id, arr);
    }
    if (rc.lead_id) {
      const arr = contractsByLead.get(rc.lead_id) || [];
      arr.push(rc);
      contractsByLead.set(rc.lead_id, arr);
    }
  }

  // Index leads by canonical interested_plot_id AND legacy interested_plot_name so ambiguous
  // bare-name or missing/mismatched project-scope leads are never missed!
  const leadsByKey = new Map<string, ReconciliationLeadRow[]>();
  const addLeadKey = (key: string, lead: ReconciliationLeadRow) => {
    if (!key) return;
    const arr = leadsByKey.get(key) || [];
    arr.push(lead);
    leadsByKey.set(key, arr);
  };
  for (const l of leads) {
    const plotIdKey = normalizeText(l.interested_plot_id);
    const plotNameKey = normalizeText(l.interested_plot_name);
    if (plotIdKey) addLeadKey(plotIdKey, l);
    if (plotNameKey && plotNameKey !== plotIdKey) addLeadKey(plotNameKey, l);
  }

  const safeToReleaseLegacyPlots: ReconciliationPlotFinding[] = [];
  const safeToSyncOccupiedPlots: ReconciliationPlotFinding[] = [];
  const needsManualReviewPlots: ReconciliationPlotFinding[] = [];
  let consistentPlots = 0;

  for (const plot of plots) {
    const plotId = normalizeText(plot.id);
    const plotName = normalizeText(plot.plot_name) || plotId;
    const projectName = normalizeText(plot.project_name);
    const currentHasCustomer = Boolean(plot.has_customer);
    const currentSaleStatusRaw = normalizeText(plot.sale_status);
    const currentSaleStatusLower = currentSaleStatusRaw.toLowerCase();
    const hasRentalMeta = hasAnyRentalMetadata(plot);
    const isVacantStatus = VACANT_PLOT_STATUSES.has(currentSaleStatusLower);
    const isTransferredStatus = TRANSFERRED_PLOT_STATUSES.has(currentSaleStatusLower);

    const plotSales = salesByPlot.get(plotId) || [];
    const activeSales = plotSales.filter(isSaleActive);
    const endedSales = plotSales.filter(s => !isSaleActive(s));

    const plotContracts = contractsByPlot.get(plotId) || [];
    const knownActiveContracts = plotContracts.filter(c =>
      KNOWN_ACTIVE_CONTRACT_STATUSES.has(normalizeText(c.status))
    );
    const vacatingEndedContracts = plotContracts.filter(c =>
      VACATING_ENDED_CONTRACT_STATUSES.has(normalizeText(c.status))
    );
    const unknownContracts = plotContracts.filter(c => {
      const st = normalizeText(c.status);
      return !KNOWN_ACTIVE_CONTRACT_STATUSES.has(st) && !NON_ACTIVE_CONTRACT_STATUSES.has(st);
    });
    const mismatchedProjectContracts = plotContracts.filter(c => {
      const cp = normalizeText(c.project_name);
      return Boolean(cp && projectName && cp !== projectName && !NON_ACTIVE_CONTRACT_STATUSES.has(normalizeText(c.status)));
    });

    // Collect candidate leads referencing plotId or plotName (deduplicated by lead.id)
    const candidateLeadMap = new Map<string, ReconciliationLeadRow>();
    for (const l of leadsByKey.get(plotId) || []) candidateLeadMap.set(l.id, l);
    if (plotName && plotName !== plotId) {
      for (const l of leadsByKey.get(plotName) || []) candidateLeadMap.set(l.id, l);
    }

    const activePurchaseLeads: ReconciliationLeadRow[] = [];
    const activeOrPendingRentalLeads: ReconciliationLeadRow[] = [];
    const conflictingLeads: ReconciliationLeadRow[] = [];
    const ambiguousReferenceLeads: { lead: ReconciliationLeadRow; match: string }[] = [];
    const endedHistoryLeads: ReconciliationLeadRow[] = [];

    for (const l of candidateLeadMap.values()) {
      const refMatch = matchLeadPlotReference(l, plot);
      if (refMatch === 'none') continue;

      const cls = classifySalesDeal(l);
      const isPurchaseHolder = isLegacyPurchaseLeadHolder(l);
      const isRentalHolder = cls.isRentalPending || cls.isRentalActive;
      const isHolderOrConflict = cls.isConflict || isRentalHolder || isPurchaseHolder;

      if (refMatch !== 'canonical') {
        if (isHolderOrConflict) {
          ambiguousReferenceLeads.push({ lead: l, match: refMatch });
        }
        continue;
      }

      if (cls.isConflict) {
        conflictingLeads.push(l);
      } else if (isRentalHolder) {
        activeOrPendingRentalLeads.push(l);
      } else if (isPurchaseHolder) {
        activePurchaseLeads.push(l);
      } else if (
        cls.isRentalEnded ||
        normalizeLower(l.status) === 'cancelled' ||
        normalizeLower(l.status) === 'canceled' ||
        normalizeLower(l.status) === 'movedout' ||
        normalizeLower(l.rental_status) === 'cancelled' ||
        normalizeLower(l.rental_status) === 'canceled' ||
        normalizeLower(l.rental_status) === 'movedout' ||
        normalizeLower(l.rental_status) === 'expired'
      ) {
        endedHistoryLeads.push(l);
      }
    }

    // Deduplicate holders sharing the same lead_id across tables
    const activeSaleLeadIds = new Set(
      activeSales.map(s => s.lead_id).filter((id): id is string => Boolean(id))
    );
    const standalonePurchaseLeads = activePurchaseLeads.filter(
      l => !activeSaleLeadIds.has(l.id)
    );

    const activeRentalLeadIdsFromContracts = new Set(
      knownActiveContracts.map(c => c.lead_id).filter((id): id is string => Boolean(id))
    );
    const standaloneRentalLeads = activeOrPendingRentalLeads.filter(
      l => !activeRentalLeadIdsFromContracts.has(l.id)
    );

    const totalActivePurchaseHolders = activeSales.length + standalonePurchaseLeads.length;
    const totalActiveRentalHolders = knownActiveContracts.length + standaloneRentalLeads.length;
    const totalActiveHolders = totalActivePurchaseHolders + totalActiveRentalHolders;

    const evidence = {
      activeSaleIds: activeSales.map(s => s.id),
      activePurchaseLeadIds: activePurchaseLeads.map(l => l.id),
      activeOrPendingContractIds: knownActiveContracts.map(c => c.id),
      activeOrPendingRentalLeadIds: activeOrPendingRentalLeads.map(l => l.id),
      ambiguousReferenceLeadIds: ambiguousReferenceLeads.map(a => a.lead.id),
      endedHistoryIds: [
        ...vacatingEndedContracts.map(c => `contract:${c.id}`),
        ...endedSales.map(s => `sale:${s.id}`),
        ...endedHistoryLeads.map(l => `lead:${l.id}`),
      ],
      unknownStatusContractIds: unknownContracts.map(c => c.id),
    };

    const baseFinding = {
      plotId,
      plotName,
      projectName,
      currentHasCustomer,
      currentSaleStatus: currentSaleStatusRaw || '(empty)',
      hasRentalMetadata: hasRentalMeta,
      evidence,
    };

    // 1. Ambiguous / invalid plot identity
    if (!plotId || !projectName) {
      needsManualReviewPlots.push({
        ...baseFinding,
        category: 'manual_review_ambiguous',
        reasonCode: 'MISSING_PLOT_OR_PROJECT_IDENTITY',
        reason: 'ข้อมูลแปลงไม่มีรหัสแปลงหรือชื่อโครงการครบถ้วน ต้องตรวจสอบด้วยตนเองก่อนดำเนินการ',
        recommendedCommand: 'manual_inspection_required',
      });
      continue;
    }

    // 2. Ambiguous legacy plot reference or mismatched project scope -> NEVER guess and release
    if (ambiguousReferenceLeads.length > 0 || mismatchedProjectContracts.length > 0) {
      const detailParts: string[] = [];
      if (ambiguousReferenceLeads.length > 0) {
        detailParts.push(
          `leads: ${ambiguousReferenceLeads.map(a => `${a.lead.id} (${a.match})`).join(', ')}`
        );
      }
      if (mismatchedProjectContracts.length > 0) {
        detailParts.push(
          `contracts: ${mismatchedProjectContracts.map(c => `${c.id} (project=${c.project_name})`).join(', ')}`
        );
      }
      needsManualReviewPlots.push({
        ...baseFinding,
        category: 'manual_review_ambiguous',
        reasonCode: 'AMBIGUOUS_LEGACY_PLOT_REFERENCE',
        reason: `พบข้อมูลผู้ถือสิทธิ์ที่อ้างอิงชื่อแปลงหรือขอบเขตโครงการกำกวม (${detailParts.join('; ')}) ห้ามเดาและคืนแปลงอัตโนมัติ`,
        recommendedCommand: 'manual_inspection_required',
      });
      continue;
    }

    // 3. Unknown rental_contracts.status on plot -> never guess
    if (unknownContracts.length > 0) {
      needsManualReviewPlots.push({
        ...baseFinding,
        category: 'manual_review_ambiguous',
        reasonCode: 'UNKNOWN_CONTRACT_STATUS',
        reason: `พบสัญญาเช่าที่มีสถานะไม่รู้จัก (${unknownContracts.map(c => c.status || 'null').join(', ')}) บนแปลงนี้ ห้ามคืนแปลงอัตโนมัติ`,
        recommendedCommand: 'manual_inspection_required',
      });
      continue;
    }

    // 4. Conflicting lead classification on plot
    if (conflictingLeads.length > 0) {
      needsManualReviewPlots.push({
        ...baseFinding,
        category: 'manual_review_ambiguous',
        reasonCode: 'CONFLICTING_LEAD_STATUS',
        reason: `พบข้อมูลลูกค้าที่มีสถานะซื้อ/เช่าขัดแย้งกัน (${conflictingLeads.map(l => l.id).join(', ')}) บนแปลงนี้ ต้องตรวจสอบก่อน`,
        recommendedCommand: 'manual_inspection_required',
      });
      continue;
    }

    // 5. Multiple active holders across sales, legacy purchase leads & rentals -> conflict!
    if (totalActiveHolders > 1) {
      needsManualReviewPlots.push({
        ...baseFinding,
        category: 'manual_review_ambiguous',
        reasonCode: 'MULTIPLE_ACTIVE_HOLDERS',
        reason: `พบผู้ถือสิทธิ์มากกว่า 1 รายพร้อมกันบนแปลงนี้ (sales: ${activeSales.length}, legacy purchase leads: ${standalonePurchaseLeads.length}, rental contracts: ${knownActiveContracts.length}, pending/active rental leads: ${standaloneRentalLeads.length})`,
        recommendedCommand: 'manual_inspection_required',
      });
      continue;
    }

    // 6. Transferred / Sold / Handover plot with rental artifacts or active rental -> conflict!
    if (isTransferredStatus) {
      if (totalActiveRentalHolders > 0 || hasRentalMeta) {
        needsManualReviewPlots.push({
          ...baseFinding,
          category: 'manual_review_ambiguous',
          reasonCode: 'TRANSFERRED_PLOT_WITH_RENTAL_DATA',
          reason: `แปลงมีสถานะโอน/ขายแล้ว (${currentSaleStatusRaw}) แต่ยังมีข้อมูลเช่าหรือสัญญาเช่าค้างอยู่ ต้องตรวจสอบด้วยตนเอง`,
          recommendedCommand: 'manual_inspection_required',
        });
      } else {
        consistentPlots++;
      }
      continue;
    }

    // 7. Single unambiguous active holder exists on this plot
    if (totalActiveHolders === 1) {
      // Purchase holder (with or without sales row) on a plot still flagged as Rented/carrying rental metadata -> manual review, NEVER release!
      if (totalActivePurchaseHolders === 1 && (currentSaleStatusLower === 'rented' || hasRentalMeta)) {
        needsManualReviewPlots.push({
          ...baseFinding,
          category: 'manual_review_ambiguous',
          reasonCode: 'PURCHASE_HOLDER_WITH_STALE_RENTAL_PLOT_DATA',
          reason: `พบผู้จองซื้อที่ยังมีผล (${activeSales[0]?.id || standalonePurchaseLeads[0]?.id}) แต่แปลงยังค้างสถานะ/ข้อมูลเช่าเก่า (sale_status=${currentSaleStatusRaw || 'empty'}) ห้ามคืนแปลงเป็นว่าง`,
          recommendedCommand: 'manual_inspection_required',
        });
        continue;
      }

      if (!currentHasCustomer || isVacantStatus) {
        const holderDesc =
          activeSales.length === 1
            ? `รายการขาย ${activeSales[0].id} (${activeSales[0].crm_stage || activeSales[0].contract_status})`
            : standalonePurchaseLeads.length === 1
              ? `ลูกค้าจองซื้อ Legacy ${standalonePurchaseLeads[0].id} (${standalonePurchaseLeads[0].status || standalonePurchaseLeads[0].crm_status})`
              : knownActiveContracts.length === 1
                ? `สัญญาเช่า ${knownActiveContracts[0].id} (${knownActiveContracts[0].status})`
                : `ลูกค้าจองเช่า ${standaloneRentalLeads[0].id} (${standaloneRentalLeads[0].rental_status || standaloneRentalLeads[0].status})`;

        safeToSyncOccupiedPlots.push({
          ...baseFinding,
          category: 'safe_stock_sync_occupied',
          reasonCode: 'ACTIVE_HOLDER_MISSING_STOCK_FLAG',
          reason: `มีผู้ถือสิทธิ์ที่ชัดเจน 1 ราย (${holderDesc}) แต่สต็อกแปลงยังแสดงเป็นว่าง (has_customer=${String(currentHasCustomer)}, sale_status=${currentSaleStatusRaw || 'empty'})`,
          recommendedCommand: 'sync_occupied_stock',
        });
      } else {
        consistentPlots++;
      }
      continue;
    }

    // 7. ZERO active holders on this plot
    const isMarkedOccupiedOrDirty = currentHasCustomer || !isVacantStatus || hasRentalMeta;
    if (!isMarkedOccupiedOrDirty) {
      consistentPlots++;
      continue;
    }

    // Legacy occupied / dirty plot with ZERO active holders:
    // ONLY classify as safely fixable if there is explicit ended/cancelled/moved-out history!
    if (evidence.endedHistoryIds.length > 0) {
      const reasonText = `แปลงค้างสถานะ Legacy (has_customer=${String(currentHasCustomer)}, sale_status=${currentSaleStatusRaw || 'empty'}, hasRentalMeta=${String(hasRentalMeta)}) โดยไม่เหลือผู้ถือสิทธิ์ซื้อ/เช่ารายใด และมีประวัติสิ้นสุด/ยกเลิกยืนยัน (${evidence.endedHistoryIds.slice(0, 3).join(', ')})`;
      safeToReleaseLegacyPlots.push({
        ...baseFinding,
        category: 'safe_legacy_plot_release',
        reasonCode: 'ORPHANED_LEGACY_OCCUPANCY_AFTER_ENDED_DEAL',
        reason: reasonText,
        recommendedCommand: 'sales_tx_release_legacy_plot',
        suggestedReleasePayload: {
          projectName,
          plotId,
          expectedHasCustomer: currentHasCustomer,
          expectedSaleStatus: currentSaleStatusRaw,
          reason: `Reconcile legacy plot after ended deal (${evidence.endedHistoryIds.slice(0, 3).join(', ')})`,
        },
      });
    } else {
      needsManualReviewPlots.push({
        ...baseFinding,
        category: 'manual_review_ambiguous',
        reasonCode: 'OCCUPIED_PLOT_WITHOUT_DEAL_HISTORY',
        reason: `แปลงถูกระบุว่าไม่ว่างหรือมีข้อมูลผู้เช่า/จองค้าง (has_customer=${String(currentHasCustomer)}, sale_status=${currentSaleStatusRaw || 'empty'}, tenant=${plot.current_tenant_name || '-'}) แต่ไม่พบทั้งผู้ถือสิทธิ์ปัจจุบันและประวัติสัญญาที่สิ้นสุด/ยกเลิก ห้ามเดาและปลดแปลงอัตโนมัติ`,
        recommendedCommand: 'manual_inspection_required',
      });
    }
  }

  // Lead-level cross-table consistency audit (read-only)
  const needsManualReviewLeads: ReconciliationLeadFinding[] = [];
  for (const l of leads) {
    const cls = classifySalesDeal(l);
    const leadContracts = contractsByLead.get(l.id) || [];
    const activeContracts = leadContracts.filter(c =>
      ['Active', 'Renewed'].includes(normalizeText(c.status))
    );

    if (cls.isConflict) {
      needsManualReviewLeads.push({
        leadId: l.id,
        customerName: normalizeText(l.customer_name) || '-',
        projectName: normalizeText(l.project_name) || '-',
        plotId: l.interested_plot_id || null,
        reasonCode: 'LEAD_DEAL_CONFLICT',
        reason: `สถานะลูกค้าขัดแย้งกัน (status=${l.status || '-'}, deal_type=${l.deal_type || '-'}, rental_status=${l.rental_status || '-'})`,
      });
      continue;
    }

    if (cls.isRentalPending && activeContracts.length > 0) {
      needsManualReviewLeads.push({
        leadId: l.id,
        customerName: normalizeText(l.customer_name) || '-',
        projectName: normalizeText(l.project_name) || '-',
        plotId: l.interested_plot_id || activeContracts[0].plot_id || null,
        reasonCode: 'PENDING_LEAD_HAS_ACTIVE_CONTRACT',
        reason: `Lead ยังแสดงเป็นจองเช่า (PendingContract) แต่พบสัญญาเช่าที่มีผลแล้ว (${activeContracts.map(c => c.id).join(', ')})`,
      });
      continue;
    }

    if (cls.isRentalActive && activeContracts.length === 0) {
      needsManualReviewLeads.push({
        leadId: l.id,
        customerName: normalizeText(l.customer_name) || '-',
        projectName: normalizeText(l.project_name) || '-',
        plotId: l.interested_plot_id || null,
        reasonCode: 'ACTIVE_RENTAL_LEAD_WITHOUT_CONTRACT',
        reason: `Lead แสดงสถานะกำลังเช่า (status=${l.status || '-'}, rental_status=${l.rental_status || '-'}) แต่ไม่พบแถวสัญญา Active/Renewed ในตาราง rental_contracts`,
      });
    }
  }

  return {
    mode: 'read_only_dry_run',
    generatedAt: new Date().toISOString(),
    summary: {
      totalPlots: plots.length,
      consistentPlots,
      safeLegacyPlotReleaseCount: safeToReleaseLegacyPlots.length,
      safeStockSyncOccupiedCount: safeToSyncOccupiedPlots.length,
      manualReviewAmbiguousCount: needsManualReviewPlots.length,
      manualReviewLeadCount: needsManualReviewLeads.length,
    },
    safeToReleaseLegacyPlots,
    safeToSyncOccupiedPlots,
    needsManualReviewPlots,
    needsManualReviewLeads,
  };
}

export function formatDryRunReportMarkdown(report: RentalReconciliationDryRunReport): string {
  const lines: string[] = [
    '# BuildTrack Rental & Plot Ownership Reconciliation (READ-ONLY DRY-RUN)',
    '',
    `- Generated At: ${report.generatedAt}`,
    `- Mode: ${report.mode} (ZERO database writes executed)`,
    '',
    '## Summary',
    `- Total Plots Audited: ${report.summary.totalPlots}`,
    `- Consistent Plots: ${report.summary.consistentPlots}`,
    `- Safe Legacy Plot Releases (via sales_tx_release_legacy_plot): ${report.summary.safeLegacyPlotReleaseCount}`,
    `- Safe Occupied Stock Syncs (review before remediation): ${report.summary.safeStockSyncOccupiedCount}`,
    `- Ambiguous / Conflicting Plots (MANUAL REVIEW ONLY): ${report.summary.manualReviewAmbiguousCount}`,
    `- Lead / Contract Cross-Table Issues (MANUAL REVIEW ONLY): ${report.summary.manualReviewLeadCount}`,
    '',
  ];

  if (report.safeToReleaseLegacyPlots.length > 0) {
    lines.push('## 1. Safely Fixable Legacy Plots (Single-Plot Guard-Approved Release)');
    for (const item of report.safeToReleaseLegacyPlots) {
      lines.push(
        `- [${item.projectName}] Plot ${item.plotName} (${item.plotId}): ${item.reason} -> Recommended: \`${item.recommendedCommand}\``
      );
    }
    lines.push('');
  }

  if (report.safeToSyncOccupiedPlots.length > 0) {
    lines.push('## 2. Occupied Plots Missing Stock Flags (Review Before Sync)');
    for (const item of report.safeToSyncOccupiedPlots) {
      lines.push(
        `- [${item.projectName}] Plot ${item.plotName} (${item.plotId}): ${item.reason}`
      );
    }
    lines.push('');
  }

  if (report.needsManualReviewPlots.length > 0) {
    lines.push('## 3. Ambiguous / Conflicting Plots (DO NOT AUTO-FIX)');
    for (const item of report.needsManualReviewPlots) {
      lines.push(
        `- [${item.projectName || 'UNKNOWN'}] Plot ${item.plotName} (${item.plotId}) [${item.reasonCode}]: ${item.reason}`
      );
    }
    lines.push('');
  }

  if (report.needsManualReviewLeads.length > 0) {
    lines.push('## 4. Lead / Contract Cross-Table Anomalies (MANUAL REVIEW)');
    for (const item of report.needsManualReviewLeads) {
      lines.push(
        `- [${item.projectName}] Lead ${item.customerName} (${item.leadId}) [${item.reasonCode}]: ${item.reason}`
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

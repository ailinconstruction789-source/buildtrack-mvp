/**
 * READ-ONLY / DRY-RUN Rental & Plot Ownership Reconciliation CLI
 *
 * Strictly read-only: NEVER performs any INSERT, UPDATE, DELETE, or RPC write.
 * Reads a JSON snapshot exported from PostgreSQL / Supabase (containing
 * { plots, sales, rentalContracts, leads }) and outputs a categorized report
 * separating safely fixable legacy plots from ambiguous/conflicting records.
 *
 * Aligned with:
 * - lib/sales/dealClassification.ts (isLegacyPurchaseLeadHolder, matchLeadPlotReference)
 * - lib/sales/rentalReconciliation.ts
 * - supabase/migrations/20261127_corrective_legacy_purchase_holder_guard.sql
 *
 * Usage:
 *   node scripts/sales-runtime/reconcile-rental-dry-run.mjs --input <snapshot.json> [--json]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const VACANT_PLOT_STATUSES = new Set(['', 'active', 'normal', 'ready_for_sale', 'available', 'vacant']);
const TRANSFERRED_PLOT_STATUSES = new Set(['transferred', 'sold', 'handover']);
const NON_ACTIVE_CONTRACT_STATUSES = new Set(['MovedOut', 'Cancelled', 'ConvertedToBuy']);
const VACATING_ENDED_CONTRACT_STATUSES = new Set(['MovedOut', 'Cancelled']);
const KNOWN_ACTIVE_CONTRACT_STATUSES = new Set(['PendingContract', 'Active', 'Renewed']);

const COMMITTED_PURCHASE_STATUSES = new Set([
  'reserved', 'booked', 'contracted', 'downpayment', 'documentprep',
  'loanprocessing', 'loansubmitted', 'loanrejected', 'approved',
  'transferpending', 'transferred', 'handover', 'closedwon',
]);
const PURCHASE_PROGRESSION_STATUSES = new Set([
  'contracted', 'downpayment', 'documentprep', 'loanprocessing',
  'loansubmitted', 'loanrejected', 'approved', 'transferpending',
  'transferred', 'handover', 'closedwon',
]);
const PRE_BOOKING_STATUSES = new Set([
  'new', 'newlead', 'active', 'followup', 'contacted',
  'interested', 'visit', 'appointment', 'negotiation', 'survey', 'loan',
]);
const TERMINAL_STATUSES = new Set([
  'lost', 'cancelled', 'canceled', 'closedlost', 'dropped',
  'unqualified', 'movedout', 'expired', 'terminated', 'nurture', 'cold', 'rejected',
]);
const RENTAL_ENDED_STATUSES = new Set([
  'movedout', 'cancelled', 'canceled', 'expired', 'terminated', 'ended',
]);

const norm = v => (typeof v === 'string' ? v.trim() : '');
const lower = v => norm(v).toLowerCase();
const compact = v => lower(v).replace(/[\s_-]+/g, '');

function isSaleActive(sale) {
  const effective = lower(sale.crm_stage) || lower(sale.contract_status) || 'unknown';
  return effective !== 'cancelled';
}

function hasRentalMeta(plot) {
  const highlight = norm(plot.highlight_note);
  const hasRentalHighlight = highlight.startsWith('จองเช่า:') || highlight.startsWith('เช่า:');
  return Boolean(
    norm(plot.current_tenant_name) ||
    norm(plot.current_tenant_phone) ||
    norm(plot.rental_program) ||
    (plot.monthly_rent != null && Number(plot.monthly_rent) !== 0) ||
    (plot.security_deposit != null && Number(plot.security_deposit) !== 0) ||
    norm(plot.lease_start_date) ||
    norm(plot.lease_end_date) ||
    hasRentalHighlight
  );
}

function classifyLeadQuick(lead) {
  const st = compact(lead.status);
  const rs = compact(lead.rental_status);
  const dt = lower(lead.deal_type);
  const crm = lower(lead.crm_status);
  const hasActiveContract = Boolean(norm(lead.active_rental_contract_id));

  // Hard conflicts -> fail closed
  if (dt === 'buy' && (['active', 'renewed', 'pendingcontract'].includes(rs) || st === 'rented')) return 'conflict';
  if (['rent', 'rent_to_own'].includes(dt) && rs !== 'convertedtobuy' && PURCHASE_PROGRESSION_STATUSES.has(st)) return 'conflict';
  if (rs === 'pendingcontract' && (st === 'rented' || PURCHASE_PROGRESSION_STATUSES.has(st) || TERMINAL_STATUSES.has(st) || hasActiveContract)) return 'conflict';
  if (['active', 'renewed'].includes(rs) && (TERMINAL_STATUSES.has(st) || PURCHASE_PROGRESSION_STATUSES.has(st))) return 'conflict';
  if (st === 'rented' && (RENTAL_ENDED_STATUSES.has(rs) || rs === 'convertedtobuy')) return 'conflict';

  // Converted to buy
  if (rs === 'convertedtobuy') {
    return TERMINAL_STATUSES.has(st) ? 'ended' : 'purchase_holder';
  }

  // Ended / terminal
  if (RENTAL_ENDED_STATUSES.has(rs) || st === 'movedout' || TERMINAL_STATUSES.has(st)) {
    return 'ended';
  }

  // Active / pending rental
  if (['active', 'renewed'].includes(rs) || st === 'rented' || (hasActiveContract && !PURCHASE_PROGRESSION_STATUSES.has(st))) {
    return 'rental_active';
  }
  if (
    rs === 'pendingcontract' ||
    (['rent', 'rent_to_own'].includes(dt) && (['reserved', 'booked', 'จองเช่า'].includes(st) || /pending[_ -]?contract|จองเช่า|รอทำสัญญา/.test(crm)))
  ) {
    return 'rental_pending';
  }
  if (dt !== 'buy' && !rs && !PURCHASE_PROGRESSION_STATUSES.has(st) && (st === 'จองเช่า' || /pending[_ -]?contract|จองเช่า|รอทำสัญญาเช่า/.test(crm))) {
    return 'rental_pending';
  }

  // Pure inquiry / pre-booking -> NEVER a purchase holder
  if (PRE_BOOKING_STATUSES.has(st)) return 'inquiry';

  // Legacy purchase holder (Reserved/Booked/Contracted/etc. without sales row)
  if (!['rent', 'rent_to_own'].includes(dt) && COMMITTED_PURCHASE_STATUSES.has(st)) {
    return 'purchase_holder';
  }
  if (!st && !['rent', 'rent_to_own'].includes(dt) && crm) {
    const crmTerm = /\b(lost|cancelled|canceled|closed_lost|dropped|unqualified|movedout|expired|terminated)\b|ยกเลิก|ไม่สนใจ|ยุติการซื้อ|ยุติการติดตาม|สิ้นสุดสัญญา|ย้ายออก/.test(crm);
    const crmRent = /\bpending[_ -]?contract\b|จองเช่า|รอทำสัญญาเช่า|ทำสัญญาเช่าแล้ว|อยู่ระหว่างเช่า|\brented\b/.test(crm);
    const crmBuy = /\b(reserved|booked|contracted|downpayment|transfer_pending|transferred|handover)\b|วางเงินจอง|จองแล้ว|ทำสัญญาแล้ว|โอนกรรมสิทธิ์|โอนแล้ว/.test(crm);
    if (crmBuy && !crmTerm && !crmRent) return 'purchase_holder';
  }

  return 'other';
}

function matchLeadPlotReference(lead, plot) {
  const plotId = norm(plot.id);
  const plotName = norm(plot.plot_name);
  const plotProject = norm(plot.project_name);
  if (!plotId) return 'none';

  const leadPlotId = norm(lead.interested_plot_id);
  const leadPlotName = norm(lead.interested_plot_name);
  const leadProject = norm(lead.project_name);

  if (leadPlotId && leadPlotId === plotId) {
    if (!plotProject) return 'ambiguous_missing_project';
    // Backward compatibility with minimal snapshots that omit leads.project_name altogether
    if (!('project_name' in lead)) return 'canonical';
    if (!leadProject) return 'ambiguous_missing_project';
    if (leadProject !== plotProject) return 'ambiguous_project_mismatch';
    return 'canonical';
  }

  const matchesName = Boolean(plotName && (leadPlotId === plotName || leadPlotName === plotName));
  if (!matchesName) return 'none';

  if (!leadProject || !plotProject) return 'ambiguous_missing_project';
  if (leadProject === plotProject) return 'ambiguous_legacy_name';
  return 'none';
}

function runDryRun(snapshot) {
  const plots = Array.isArray(snapshot.plots) ? snapshot.plots : [];
  const sales = Array.isArray(snapshot.sales) ? snapshot.sales : [];
  const rentalContracts = Array.isArray(snapshot.rentalContracts) ? snapshot.rentalContracts : [];
  const leads = Array.isArray(snapshot.leads) ? snapshot.leads : [];

  const safeToReleaseLegacyPlots = [];
  const safeToSyncOccupiedPlots = [];
  const needsManualReviewPlots = [];
  let consistentPlots = 0;

  for (const plot of plots) {
    const plotId = norm(plot.id);
    const projectName = norm(plot.project_name);
    const hasCustomer = Boolean(plot.has_customer);
    const saleStatusRaw = norm(plot.sale_status);
    const saleStatusLower = saleStatusRaw.toLowerCase();
    const rentalMeta = hasRentalMeta(plot);

    const pSales = sales.filter(s => s.plot_id === plotId);
    const activeSales = pSales.filter(isSaleActive);
    const endedSales = pSales.filter(s => !isSaleActive(s));

    const pContracts = rentalContracts.filter(c => c.plot_id === plotId);
    const activeContracts = pContracts.filter(c => KNOWN_ACTIVE_CONTRACT_STATUSES.has(norm(c.status)));
    const vacatingEndedContracts = pContracts.filter(c => VACATING_ENDED_CONTRACT_STATUSES.has(norm(c.status)));
    const unknownContracts = pContracts.filter(
      c => !KNOWN_ACTIVE_CONTRACT_STATUSES.has(norm(c.status)) && !NON_ACTIVE_CONTRACT_STATUSES.has(norm(c.status))
    );
    const mismatchedProjectContracts = pContracts.filter(c => {
      const cp = norm(c.project_name);
      return Boolean(cp && projectName && cp !== projectName && !NON_ACTIVE_CONTRACT_STATUSES.has(norm(c.status)));
    });

    const activePurchaseLeads = [];
    const activeRentalLeads = [];
    const conflictLeads = [];
    const ambiguousRefLeads = [];
    const endedLeads = [];

    for (const l of leads) {
      const refMatch = matchLeadPlotReference(l, plot);
      if (refMatch === 'none') continue;
      const kind = classifyLeadQuick(l);
      const isHolderOrConflict = ['purchase_holder', 'rental_pending', 'rental_active', 'conflict'].includes(kind);

      if (refMatch !== 'canonical') {
        if (isHolderOrConflict) ambiguousRefLeads.push({ id: l.id, match: refMatch });
        continue;
      }

      if (kind === 'conflict') conflictLeads.push(l);
      else if (kind === 'rental_pending' || kind === 'rental_active') activeRentalLeads.push(l);
      else if (kind === 'purchase_holder') activePurchaseLeads.push(l);
      else if (
        kind === 'ended' &&
        (['cancelled', 'canceled', 'movedout'].includes(compact(l.status)) ||
          ['cancelled', 'canceled', 'movedout', 'expired'].includes(compact(l.rental_status)))
      ) {
        endedLeads.push(l);
      }
    }

    const activeSaleLeadIds = new Set(activeSales.map(s => s.lead_id).filter(Boolean));
    const standalonePurchaseLeads = activePurchaseLeads.filter(l => !activeSaleLeadIds.has(l.id));

    const contractLeadIds = new Set(activeContracts.map(c => c.lead_id).filter(Boolean));
    const standaloneRentalLeads = activeRentalLeads.filter(l => !contractLeadIds.has(l.id));

    const totalPurchaseHolders = activeSales.length + standalonePurchaseLeads.length;
    const totalRentalHolders = activeContracts.length + standaloneRentalLeads.length;
    const totalHolders = totalPurchaseHolders + totalRentalHolders;

    const endedHistory = [
      ...vacatingEndedContracts.map(c => `contract:${c.id}`),
      ...endedSales.map(s => `sale:${s.id}`),
      ...endedLeads.map(l => `lead:${l.id}`),
    ];

    if (!plotId || !projectName) {
      needsManualReviewPlots.push({ plotId, projectName, reasonCode: 'MISSING_PLOT_OR_PROJECT_IDENTITY' });
      continue;
    }
    if (ambiguousRefLeads.length > 0 || mismatchedProjectContracts.length > 0) {
      needsManualReviewPlots.push({
        plotId,
        projectName,
        reasonCode: 'AMBIGUOUS_LEGACY_PLOT_REFERENCE',
        ambiguousLeads: ambiguousRefLeads,
      });
      continue;
    }
    if (unknownContracts.length > 0) {
      needsManualReviewPlots.push({ plotId, projectName, reasonCode: 'UNKNOWN_CONTRACT_STATUS' });
      continue;
    }
    if (conflictLeads.length > 0) {
      needsManualReviewPlots.push({ plotId, projectName, reasonCode: 'CONFLICTING_LEAD_STATUS' });
      continue;
    }
    if (totalHolders > 1) {
      needsManualReviewPlots.push({ plotId, projectName, reasonCode: 'MULTIPLE_ACTIVE_HOLDERS', totalHolders });
      continue;
    }
    if (TRANSFERRED_PLOT_STATUSES.has(saleStatusLower)) {
      if (totalRentalHolders > 0 || rentalMeta) {
        needsManualReviewPlots.push({ plotId, projectName, reasonCode: 'TRANSFERRED_PLOT_WITH_RENTAL_DATA' });
      } else {
        consistentPlots++;
      }
      continue;
    }
    if (totalHolders === 1) {
      if (totalPurchaseHolders === 1 && (saleStatusLower === 'rented' || rentalMeta)) {
        needsManualReviewPlots.push({
          plotId,
          projectName,
          reasonCode: 'PURCHASE_HOLDER_WITH_STALE_RENTAL_PLOT_DATA',
          currentHasCustomer: hasCustomer,
          currentSaleStatus: saleStatusRaw,
        });
        continue;
      }
      if (!hasCustomer || VACANT_PLOT_STATUSES.has(saleStatusLower)) {
        safeToSyncOccupiedPlots.push({
          plotId,
          projectName,
          reasonCode: 'ACTIVE_HOLDER_MISSING_STOCK_FLAG',
          currentHasCustomer: hasCustomer,
          currentSaleStatus: saleStatusRaw,
        });
      } else {
        consistentPlots++;
      }
      continue;
    }

    const dirty = hasCustomer || !VACANT_PLOT_STATUSES.has(saleStatusLower) || rentalMeta;
    if (!dirty) {
      consistentPlots++;
      continue;
    }

    if (endedHistory.length > 0) {
      safeToReleaseLegacyPlots.push({
        plotId,
        projectName,
        reasonCode: 'ORPHANED_LEGACY_OCCUPANCY_AFTER_ENDED_DEAL',
        recommendedCommand: 'sales_tx_release_legacy_plot',
        suggestedReleasePayload: {
          projectName,
          plotId,
          expectedHasCustomer: hasCustomer,
          expectedSaleStatus: saleStatusRaw,
          reason: `Reconcile legacy plot after ended deal (${endedHistory.slice(0, 3).join(', ')})`,
        },
      });
    } else {
      needsManualReviewPlots.push({
        plotId,
        projectName,
        reasonCode: 'OCCUPIED_PLOT_WITHOUT_DEAL_HISTORY',
        currentHasCustomer: hasCustomer,
        currentSaleStatus: saleStatusRaw,
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
    },
    safeToReleaseLegacyPlots,
    safeToSyncOccupiedPlots,
    needsManualReviewPlots,
  };
}

const args = process.argv.slice(2);
const inputIdx = args.indexOf('--input');
if (inputIdx === -1 || !args[inputIdx + 1]) {
  console.error('Usage: node scripts/sales-runtime/reconcile-rental-dry-run.mjs --input <snapshot.json> [--json]');
  process.exit(1);
}

const snapshotPath = resolve(args[inputIdx + 1]);
let rawText = readFileSync(snapshotPath, 'utf8').replace(/^\uFEFF/, '').trim();
// Auto-unwrap Supabase SQL Editor CSV export:
//   reconciliation_snapshot
//   "{""leads"":[...]}"
if (rawText.startsWith('reconciliation_snapshot')) {
  const lines = rawText.split(/\r?\n/);
  const payloadLine = lines.slice(1).join('\n').trim();
  if (payloadLine.startsWith('"') && payloadLine.endsWith('"')) {
    rawText = payloadLine.slice(1, -1).replaceAll('""', '"');
  } else {
    rawText = payloadLine;
  }
}
const rawSnapshot = JSON.parse(rawText);
// Auto-unwrap Supabase SQL Editor export wrapper: [{ reconciliation_snapshot: { ... } }] or { reconciliation_snapshot: { ... } }
const snapshot = Array.isArray(rawSnapshot)
  ? (rawSnapshot[0]?.reconciliation_snapshot ?? rawSnapshot[0] ?? {})
  : (rawSnapshot?.reconciliation_snapshot ?? rawSnapshot);
const report = runDryRun(snapshot);

if (args.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Mode: ${report.mode}`);
  console.log(`Total plots: ${report.summary.totalPlots}`);
  console.log(`Consistent: ${report.summary.consistentPlots}`);
  console.log(`Safe legacy releases: ${report.summary.safeLegacyPlotReleaseCount}`);
  console.log(`Safe occupied stock syncs: ${report.summary.safeStockSyncOccupiedCount}`);
  console.log(`Manual review (ambiguous/conflict): ${report.summary.manualReviewAmbiguousCount}`);
  if (report.safeToReleaseLegacyPlots.length > 0) {
    console.log('\nSafe legacy releases:', JSON.stringify(report.safeToReleaseLegacyPlots, null, 2));
  }
  if (report.needsManualReviewPlots.length > 0) {
    console.log('\nManual review required:', JSON.stringify(report.needsManualReviewPlots, null, 2));
  }
}

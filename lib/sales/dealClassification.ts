import type { LeadStageInput } from './leadStage';

export type SalesDealCategory =
  | 'purchase'
  | 'rental_pending'
  | 'rental_active'
  | 'rental_ended'
  | 'converted_to_buy'
  | 'conflict';

export const RENTAL_PENDING_DISPLAY_LABEL = 'จองเช่า — รอทำสัญญา';
export const RENTAL_SIGN_CONTRACT_BUTTON_LABEL = 'ทำสัญญาเช่าจริง';

export function getSalesDealConflictMessage(reason?: string | null): string {
  switch (reason) {
    case 'active_sale_conflicts_with_rental':
      return 'พบรายการขาย (Sale) ที่ยังไม่ยกเลิกขัดแย้งกับข้อมูลการเช่า (PendingContract / Active) กรุณาตรวจสอบข้อมูลทั้งสองฝั่งก่อนทำรายการ';
    case 'buy_deal_type_conflicts_with_rental_status':
      return 'ประเภทดีลระบุเป็นซื้อ (buy) แต่สถานะการเช่ายังเปิดอยู่ (PendingContract / Active / Rented) กรุณาตรวจสอบก่อนแก้ไข';
    case 'rent_deal_type_conflicts_with_purchase_status':
      return 'ประเภทดีลระบุเป็นเช่า (rent) แต่สถานะอยู่ในขั้นตอนการขายซื้อ กรุณาตรวจสอบก่อนแก้ไข';
    case 'pending_rental_conflicts_with_status_or_contract':
      return 'สถานะการจองเช่ารอทำสัญญา (PendingContract) ขัดแย้งกับสถานะหลักหรือรหัสสัญญาเช่าที่ใช้งานอยู่ กรุณาตรวจสอบก่อนทำรายการ';
    case 'active_rental_conflicts_with_lead_status':
      return 'สถานะสัญญาเช่า (Active/Renewed) ขัดแย้งกับสถานะหลักของลูกค้า กรุณาตรวจสอบก่อนแก้ไข';
    case 'rented_status_conflicts_with_ended_or_converted':
      return 'สถานะหลักยังเป็น Rented แต่สถานะการเช่าระบุว่าสิ้นสุดหรือเปลี่ยนเป็นซื้อแล้ว กรุณาตรวจสอบก่อนทำรายการ';
    default:
      return 'พบข้อมูลประเภทดีลซื้อและเช่าขัดแย้งกัน ระบบล็อกโหมดอ่านอย่างเดียวเพื่อป้องกันการเขียนทับข้อมูลผิดประเภท กรุณาตรวจสอบข้อมูลก่อนดำเนินการ';
  }
}

export interface SalesDealClassificationInput extends LeadStageInput {
  deal_type?: unknown;
  dealType?: unknown;
  rental_status?: unknown;
  rentalStatus?: unknown;
  active_rental_contract_id?: unknown;
  activeRentalContractId?: unknown;
  rental_program?: unknown;
  sourceKind?: unknown;
  saleId?: unknown;
  contract_status?: unknown;
  crmStage?: unknown;
  crm_stage?: unknown;
  interested_plot_id?: unknown;
  interested_plot_name?: unknown;
  plotId?: unknown;
  plot_id?: unknown;
  plot?: unknown;
  project_name?: unknown;
  projectName?: unknown;
  interests?: unknown;
}

export interface SalesDealClassification {
  category: SalesDealCategory;
  isPurchaseFlow: boolean;
  isRentalPending: boolean;
  isRentalActive: boolean;
  isRentalEnded: boolean;
  isConvertedToBuy: boolean;
  isConflict: boolean;
  isTerminal: boolean;
  blocksPurchaseModal: boolean;
  blocksWriteActions: boolean;
  reason: string;
}

const rawText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const lowerText = (value: unknown): string => rawText(value).toLowerCase();
const compactText = (value: unknown): string => lowerText(value).replace(/[\s_-]+/g, '');

const PURCHASE_PROGRESSION_STATUSES = new Set([
  'contracted',
  'downpayment',
  'documentprep',
  'loanprocessing',
  'loansubmitted',
  'loanrejected',
  'approved',
  'transferpending',
  'transferred',
  'handover',
  'closedwon',
]);

const TERMINAL_END_STATUSES = new Set([
  'lost',
  'cancelled',
  'canceled',
  'closedlost',
  'dropped',
  'unqualified',
  'movedout',
  'expired',
  'terminated',
]);

const RENTAL_ENDED_STATUSES = new Set([
  'movedout',
  'cancelled',
  'canceled',
  'expired',
  'terminated',
  'ended',
]);

const RENTAL_ACTIVE_STATUSES = new Set(['active', 'renewed']);
const RENTAL_PENDING_STATUSES = new Set(['pendingcontract']);

const buildResult = (
  category: SalesDealCategory,
  overrides: Partial<Omit<SalesDealClassification, 'category'>> & { reason: string }
): SalesDealClassification => ({
  category,
  isPurchaseFlow: category === 'purchase' || category === 'converted_to_buy',
  isRentalPending: category === 'rental_pending',
  isRentalActive: category === 'rental_active',
  isRentalEnded: category === 'rental_ended',
  isConvertedToBuy: category === 'converted_to_buy',
  isConflict: category === 'conflict',
  isTerminal: category === 'rental_ended',
  blocksPurchaseModal:
    category === 'rental_pending' ||
    category === 'rental_active' ||
    category === 'rental_ended' ||
    category === 'conflict',
  blocksWriteActions: category === 'conflict',
  ...overrides,
});

/**
 * Classifies a lead/deal from structured fields first, with guarded legacy CRM fallback.
 * - Terminal statuses (MovedOut, Cancelled, Lost, Expired) and ConvertedToBuy are never
 *   pulled back into active or pending rental by legacy CRM text containing "เช่า".
 * - Contradictory structured fields return `conflict` so UI and modals block unsafe writes.
 */
export function classifySalesDeal(
  input: SalesDealClassificationInput | null | undefined
): SalesDealClassification {
  if (!input) {
    return buildResult('purchase', { isTerminal: false, reason: 'empty_input' });
  }

  const dealType = lowerText(input.deal_type ?? input.dealType);
  const isRentDealType = dealType === 'rent' || dealType === 'rent_to_own';
  const isBuyDealType = dealType === 'buy';

  const rentalStatus = compactText(input.rental_status ?? input.rentalStatus);
  const statusCompact = compactText(input.status);
  const intakeCompact = compactText(input.intakeStatus);
  const crmLower = lowerText(input.crm_status);
  const contractStatusCompact = compactText(input.contract_status);
  const activeContractId = rawText(input.active_rental_contract_id ?? input.activeRentalContractId);
  const sourceKind = lowerText(input.sourceKind);
  const hasActiveSale = Boolean(
    rawText(input.saleId) && contractStatusCompact !== 'cancelled' && contractStatusCompact !== 'canceled'
  );

  const isConvertedRentalStatus =
    rentalStatus === 'convertedtobuy' || statusCompact === 'convertedtobuy';
  const isCrmConverted =
    crmLower.includes('convertedtobuy') ||
    crmLower.includes('เปลี่ยนจากเช่าเป็นซื้อ') ||
    crmLower.includes('เปลี่ยนเป็นซื้อ');
  const isCrmTerminal =
    /\b(lost|cancelled|canceled|closed_lost|dropped|unqualified|movedout|expired|terminated)\b|ยกเลิก|ไม่สนใจ|ยุติการซื้อ|ยุติการติดตาม|สิ้นสุดสัญญา|ย้ายออก/.test(
      crmLower
    );
  const isCrmRentalPending =
    /\bpending[_ -]?contract\b|จองเช่า|รอทำสัญญาเช่า|รอทำสัญญา.*เช่า|เช่า.*รอทำสัญญา/.test(crmLower);
  const isCrmRentalActive =
    !isCrmConverted &&
    !isCrmTerminal &&
    !isCrmRentalPending &&
    (/\brented\b|rent-to-own\s*\/\s*active|ทำสัญญาเช่าแล้ว|อยู่ระหว่างเช่า|สัญญาเช่าซื้อ\/เช่าออม/.test(
      crmLower
    ));

  // 0. Plot-derived synthetic rental row (no lead row)
  if (sourceKind === 'rental_plot') {
    if (RENTAL_ENDED_STATUSES.has(rentalStatus) || TERMINAL_END_STATUSES.has(statusCompact)) {
      return buildResult('rental_ended', { reason: 'rental_plot_ended' });
    }
    return buildResult('rental_active', { reason: 'rental_plot_active' });
  }

  // 1. Contradictory structured fields -> conflict (block unsafe wrong-type writes)
  if (
    hasActiveSale &&
    !isConvertedRentalStatus &&
    (RENTAL_ACTIVE_STATUSES.has(rentalStatus) ||
      RENTAL_PENDING_STATUSES.has(rentalStatus) ||
      statusCompact === 'rented' ||
      isRentDealType)
  ) {
    return buildResult('conflict', { reason: 'active_sale_conflicts_with_rental' });
  }

  if (
    isBuyDealType &&
    (RENTAL_ACTIVE_STATUSES.has(rentalStatus) ||
      RENTAL_PENDING_STATUSES.has(rentalStatus) ||
      statusCompact === 'rented')
  ) {
    return buildResult('conflict', { reason: 'buy_deal_type_conflicts_with_rental_status' });
  }

  if (isRentDealType && !isConvertedRentalStatus && PURCHASE_PROGRESSION_STATUSES.has(statusCompact)) {
    return buildResult('conflict', { reason: 'rent_deal_type_conflicts_with_purchase_status' });
  }

  if (
    RENTAL_PENDING_STATUSES.has(rentalStatus) &&
    (statusCompact === 'rented' ||
      PURCHASE_PROGRESSION_STATUSES.has(statusCompact) ||
      TERMINAL_END_STATUSES.has(statusCompact) ||
      Boolean(activeContractId))
  ) {
    return buildResult('conflict', { reason: 'pending_rental_conflicts_with_status_or_contract' });
  }

  if (
    RENTAL_ACTIVE_STATUSES.has(rentalStatus) &&
    (TERMINAL_END_STATUSES.has(statusCompact) || PURCHASE_PROGRESSION_STATUSES.has(statusCompact))
  ) {
    return buildResult('conflict', { reason: 'active_rental_conflicts_with_lead_status' });
  }

  if (statusCompact === 'rented' && (RENTAL_ENDED_STATUSES.has(rentalStatus) || isConvertedRentalStatus)) {
    return buildResult('conflict', { reason: 'rented_status_conflicts_with_ended_or_converted' });
  }

  // 2. Converted from rental to purchase (must never be dragged back into rental by old CRM text)
  if (
    isConvertedRentalStatus ||
    (isCrmConverted &&
      !RENTAL_ACTIVE_STATUSES.has(rentalStatus) &&
      !RENTAL_PENDING_STATUSES.has(rentalStatus) &&
      !RENTAL_ENDED_STATUSES.has(rentalStatus) &&
      statusCompact !== 'rented')
  ) {
    const isTerminal = TERMINAL_END_STATUSES.has(statusCompact) || statusCompact === 'handover';
    return buildResult('converted_to_buy', {
      isTerminal,
      isPurchaseFlow: true,
      blocksPurchaseModal: false,
      reason: isConvertedRentalStatus ? 'structured_converted_to_buy' : 'crm_converted_to_buy',
    });
  }

  // 3. Terminal / ended rental (must never be dragged back into active/pending rental by old CRM text)
  if (
    RENTAL_ENDED_STATUSES.has(rentalStatus) ||
    statusCompact === 'movedout' ||
    (isRentDealType && TERMINAL_END_STATUSES.has(statusCompact)) ||
    (TERMINAL_END_STATUSES.has(statusCompact) &&
      (crmLower.includes('เช่า') || crmLower.includes('movedout') || Boolean(rawText(input.rental_program)))) ||
    (!statusCompact &&
      isCrmTerminal &&
      (isRentDealType || crmLower.includes('เช่า') || crmLower.includes('movedout')))
  ) {
    return buildResult('rental_ended', { reason: 'structured_or_crm_rental_ended' });
  }

  // 4. Active / Renewed rental contract
  if (
    RENTAL_ACTIVE_STATUSES.has(rentalStatus) ||
    statusCompact === 'rented' ||
    (Boolean(activeContractId) &&
      !TERMINAL_END_STATUSES.has(statusCompact) &&
      !PURCHASE_PROGRESSION_STATUSES.has(statusCompact)) ||
    (!dealType &&
      !rentalStatus &&
      !TERMINAL_END_STATUSES.has(statusCompact) &&
      !PURCHASE_PROGRESSION_STATUSES.has(statusCompact) &&
      statusCompact !== 'reserved' &&
      statusCompact !== 'booked' &&
      isCrmRentalActive)
  ) {
    return buildResult('rental_active', {
      reason: RENTAL_ACTIVE_STATUSES.has(rentalStatus)
        ? 'structured_rental_active'
        : statusCompact === 'rented'
          ? 'status_rented'
          : activeContractId
            ? 'active_contract_id'
            : 'legacy_crm_rental_active',
    });
  }

  // 5. Pending rental booking (waiting for real rental contract)
  const hasBookingSignal =
    ['reserved', 'booked', 'จองเช่า'].includes(statusCompact) ||
    intakeCompact === 'booked' ||
    isCrmRentalPending ||
    Boolean(input.booking_date) ||
    input.booking_amount != null;

  if (
    RENTAL_PENDING_STATUSES.has(rentalStatus) ||
    (isRentDealType && hasBookingSignal) ||
    (!isBuyDealType &&
      !rentalStatus &&
      !TERMINAL_END_STATUSES.has(statusCompact) &&
      !PURCHASE_PROGRESSION_STATUSES.has(statusCompact) &&
      (statusCompact === 'จองเช่า' || isCrmRentalPending))
  ) {
    return buildResult('rental_pending', {
      reason: RENTAL_PENDING_STATUSES.has(rentalStatus)
        ? 'structured_pending_contract'
        : isRentDealType
          ? 'rent_deal_with_booking_signal'
          : 'legacy_crm_rental_pending',
    });
  }

  // 6. Standard purchase flow (including pre-booking active/visit/loan leads and purchase bookings/transfers)
  const isTerminal =
    TERMINAL_END_STATUSES.has(statusCompact) ||
    statusCompact === 'handover' ||
    (!statusCompact && isCrmTerminal);

  return buildResult('purchase', {
    isTerminal,
    isPurchaseFlow: true,
    blocksPurchaseModal: false,
    reason: 'purchase_flow',
  });
}

const COMMITTED_PURCHASE_LEAD_STATUSES = new Set([
  'reserved',
  'booked',
  ...PURCHASE_PROGRESSION_STATUSES,
]);

const PRE_BOOKING_INQUIRY_STATUSES = new Set([
  'new',
  'newlead',
  'active',
  'followup',
  'contacted',
  'interested',
  'visit',
  'appointment',
  'negotiation',
  'survey',
  'loan',
]);

/**
 * Determines whether a lead holds an active/committed LEGACY PURCHASE claim
 * (even when no row exists in `public.sales`).
 *
 * Strictly mirrors `sales_private.lead_is_legacy_purchase_holder(public.leads)`:
 * - Covers Reserved, Booked, Contracted, DownPayment, DocumentPrep, LoanProcessing,
 *   LoanSubmitted, LoanRejected, Approved, TransferPending, Transferred, Handover,
 *   ClosedWon, and non-terminal ConvertedToBuy.
 * - Strictly EXCLUDES pre-booking/inquiry leads (New, Active, Follow Up, Contacted,
 *   Interested, Visit, Appointment, Negotiation, Survey, Loan) and terminal/ended
 *   leads so inquiry leads NEVER create artificial purchase claims.
 */
export function isLegacyPurchaseLeadHolder(
  input: SalesDealClassificationInput | null | undefined
): boolean {
  if (!input) return false;

  const deal = classifySalesDeal(input);
  if (deal.isConflict || deal.isRentalPending || deal.isRentalActive || deal.isRentalEnded) {
    return false;
  }

  const statusCompact = compactText(input.status);
  const rentalStatus = compactText(input.rental_status ?? input.rentalStatus);
  const dealType = lowerText(input.deal_type ?? input.dealType);
  const crmLower = lowerText(input.crm_status);

  if (
    TERMINAL_END_STATUSES.has(statusCompact) ||
    statusCompact === 'nurture' ||
    statusCompact === 'cold' ||
    statusCompact === 'rejected'
  ) {
    return false;
  }

  if (RENTAL_ENDED_STATUSES.has(rentalStatus)) {
    return false;
  }

  if ((dealType === 'rent' || dealType === 'rent_to_own') && rentalStatus !== 'convertedtobuy') {
    return false;
  }

  if (deal.isConvertedToBuy || rentalStatus === 'convertedtobuy') {
    return !deal.isTerminal;
  }

  if (PRE_BOOKING_INQUIRY_STATUSES.has(statusCompact)) {
    return false;
  }

  if (COMMITTED_PURCHASE_LEAD_STATUSES.has(statusCompact)) {
    return true;
  }

  // Legacy blank-status fallback: honor explicit non-terminal, non-rental purchase CRM text only
  if (!statusCompact && crmLower) {
    const isCrmTerminal =
      /\b(lost|cancelled|canceled|closed_lost|dropped|unqualified|movedout|expired|terminated)\b|ยกเลิก|ไม่สนใจ|ยุติการซื้อ|ยุติการติดตาม|สิ้นสุดสัญญา|ย้ายออก/.test(
        crmLower
      );
    const isCrmRental =
      /\bpending[_ -]?contract\b|จองเช่า|รอทำสัญญาเช่า|ทำสัญญาเช่าแล้ว|อยู่ระหว่างเช่า|\brented\b/.test(
        crmLower
      );
    const isCrmCommittedPurchase =
      /\b(reserved|booked|contracted|downpayment|transfer_pending|transferred|handover)\b|วางเงินจอง|จองแล้ว|ทำสัญญาแล้ว|โอนกรรมสิทธิ์|โอนแล้ว/.test(
        crmLower
      );
    if (isCrmCommittedPurchase && !isCrmTerminal && !isCrmRental) {
      return true;
    }
  }

  return false;
}

export type LeadPlotReferenceMatch =
  | 'canonical'
  | 'ambiguous_project_mismatch'
  | 'ambiguous_legacy_name'
  | 'ambiguous_missing_project'
  | 'none';

/**
 * Classifies how a lead references a canonical plot within project scope.
 * Mirrors `sales_private.plot_has_ambiguous_legacy_reference(public.plots)`.
 * Never guesses bare plot names or missing/mismatched project scope as canonical!
 */
export function matchLeadPlotReference(
  lead: {
    project_name?: unknown;
    interested_plot_id?: unknown;
    interested_plot_name?: unknown;
  },
  plot: {
    id?: unknown;
    plot_name?: unknown;
    project_name?: unknown;
  }
): LeadPlotReferenceMatch {
  const plotId = rawText(plot.id);
  const plotName = rawText(plot.plot_name);
  const plotProject = rawText(plot.project_name);
  if (!plotId) return 'none';

  const leadPlotId = rawText(lead.interested_plot_id);
  const leadPlotName = rawText(lead.interested_plot_name);
  const leadProject = rawText(lead.project_name);

  if (leadPlotId && leadPlotId === plotId) {
    if (!plotProject) return 'ambiguous_missing_project';
    if (!leadProject) return 'ambiguous_missing_project';
    if (leadProject !== plotProject) return 'ambiguous_project_mismatch';
    return 'canonical';
  }

  const matchesPlotName = Boolean(
    plotName && (leadPlotId === plotName || leadPlotName === plotName)
  );
  if (!matchesPlotName) return 'none';

  if (!leadProject || !plotProject) {
    return 'ambiguous_missing_project';
  }
  if (leadProject === plotProject) {
    return 'ambiguous_legacy_name';
  }
  return 'none';
}

export interface PlotLookupRow {
  id?: string | null;
  plot_name?: string | null;
  project_name?: string | null;
  project?: string | null;
}

/**
 * Resolves the canonical `plots.id` for a lead when plot metadata is available,
 * preventing plot-name / alias mismatches when opening modals like RentalContractModal.
 */
export function resolveCanonicalPlotId(
  lead: Record<string, any> | null | undefined,
  plots: PlotLookupRow[] = []
): string | null {
  if (!lead) return null;

  const firstInterest = Array.isArray(lead.interests) ? lead.interests[0] : null;
  const projectName = lowerText(
    lead.project_name || lead.projectName || firstInterest?.projectName
  );

  const candidates = Array.from(
    new Set(
      [
        lead.interested_plot_id,
        lead.plotId,
        lead.plot_id,
        lead.plot,
        firstInterest?.plotId,
        lead.interested_plot_name,
        lead.plotName,
        firstInterest?.plotName,
      ]
        .map(rawText)
        .filter(Boolean)
    )
  );

  if (candidates.length === 0) return null;

  if (plots.length > 0) {
    const projectMatches = (plot: PlotLookupRow) => {
      if (!projectName) return true;
      const plotProj = lowerText(plot.project_name || plot.project);
      return !plotProj || plotProj === projectName;
    };

    const scopedPlots = plots.filter(projectMatches);

    // 1. Exact ID match within the lead's project (or globally if unscoped)
    for (const candidate of candidates) {
      const byScopedId = scopedPlots.find(p => rawText(p.id) === candidate);
      if (byScopedId?.id) return String(byScopedId.id);
    }
    for (const candidate of candidates) {
      const byGlobalId = plots.find(p => rawText(p.id) === candidate);
      if (byGlobalId?.id && (!projectName || projectMatches(byGlobalId))) {
        return String(byGlobalId.id);
      }
    }

    // 2. Unique plot_name match within the lead's project
    for (const candidate of candidates) {
      const byScopedName = scopedPlots.filter(p => rawText(p.plot_name) === candidate);
      if (byScopedName.length === 1 && byScopedName[0].id) {
        return String(byScopedName[0].id);
      }
    }
  }

  return candidates[0] || null;
}

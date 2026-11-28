import { supabase } from './supabase';
import {
  classifySalesDeal,
  isLegacyPurchaseLeadHolder,
  matchLeadPlotReference,
} from './sales/dealClassification';
import {
  createTxRequestId,
  isAdminWriteRole,
  releaseLegacyPlotTx,
  translateSalesTxError,
} from './sales/rentalTxClient';
import { broadcastSalesSync } from './sales/salesSyncBroadcast';

export interface DeleteCustomerOptions {
  actorRole?: unknown;
  /** Optional explicit request ID prefix for legacy plot release idempotency */
  requestId?: string;
}

export interface DeleteCustomerResult {
  success: boolean;
  leadId: string;
  customerName?: string;
  releasedPlotIds: string[];
  skippedPlotIds?: string[];
  deletedPaymentsCount: number;
  deletedContractsCount: number;
  error?: string;
  errorCode?: string;
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

const ENDED_CONTRACT_STATUSES = new Set([
  'MovedOut',
  'Cancelled',
  'ConvertedToBuy',
]);

const VACATING_ENDED_CONTRACT_STATUSES = new Set([
  'MovedOut',
  'Cancelled',
]);

function normalizeText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function isSaleActive(sale: { contract_status?: string | null; crm_stage?: string | null }): boolean {
  const stage = normalizeText(sale.crm_stage).toLowerCase();
  const status = normalizeText(sale.contract_status).toLowerCase();
  const effective = stage || status || 'unknown';
  return effective !== 'cancelled';
}

function plotHasLegacyOccupancyOrRentalData(plot: Record<string, any>): boolean {
  const statusLower = normalizeText(plot.sale_status).toLowerCase();
  const highlight = normalizeText(plot.highlight_note);
  const hasRentalHighlight = highlight.startsWith('จองเช่า:') || highlight.startsWith('เช่า:');
  return Boolean(
    plot.has_customer === true ||
      !VACANT_PLOT_STATUSES.has(statusLower) ||
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
 * Hardened Admin Customer Deletion Helper:
 *
 * Security & Integrity Rules (Phase 3):
 * 1. Admin-only: rejects non-admin callers when `options.actorRole` is provided (or missing/read-only).
 * 2. NEVER acts as a shortcut bypassing rental cancellation, move-out, or purchase cancellation:
 *    Blocks deletion if the lead currently has ANY PendingContract/Active/Renewed/unknown rental
 *    OR ANY non-cancelled purchase sale.
 * 3. NEVER writes `plots.sale_status` or `plots.has_customer` directly and NEVER uses unscoped
 *    `.or('id.eq...,plot_name.eq...')` across projects.
 * 4. Checks CURRENT plot ownership across `sales`, `rental_contracts`, and `leads`:
 *    - Plots currently held by ANOTHER buyer or tenant are NEVER touched.
 *    - Leftover legacy occupancy on an already-ended lead's plot (with ZERO current holders)
 *      is released ONLY through the guard-approved RPC `sales_tx_release_legacy_plot`.
 *    - If plot release fails, deletion ABORTS immediately (never silently continues).
 * 5. Checks `{ error }` on every database read/delete step.
 */
export async function deleteCustomerWithCascade(
  leadId: string,
  fallbackPlotId?: string | null,
  options?: DeleteCustomerOptions
): Promise<DeleteCustomerResult> {
  const releasedPlotIds: string[] = [];
  const skippedPlotIds: string[] = [];
  let deletedPaymentsCount = 0;
  let deletedContractsCount = 0;
  let customerName: string | undefined;

  if (!leadId) {
    return {
      success: false,
      leadId: '',
      releasedPlotIds,
      skippedPlotIds,
      deletedPaymentsCount,
      deletedContractsCount,
      error: 'ไม่พบรหัสลูกค้า (Lead ID) ที่ต้องการลบ',
      errorCode: 'INVALID_INPUT',
    };
  }

  // Enforce Admin write permission strictly
  if (!options || !isAdminWriteRole(options.actorRole)) {
    return {
      success: false,
      leadId,
      releasedPlotIds,
      skippedPlotIds,
      deletedPaymentsCount,
      deletedContractsCount,
      error: 'คุณไม่มีสิทธิ์ในการลบข้อมูลลูกค้า (เฉพาะ Admin เท่านั้น)',
      errorCode: 'FORBIDDEN',
    };
  }

  try {
    // 1. Fetch fresh lead details
    const { data: lead, error: leadFetchErr } = await supabase
      .from('leads')
      .select(
        'id, customer_name, interested_plot_id, interested_plot_name, project_name, status, crm_status, deal_type, rental_status, active_rental_contract_id'
      )
      .eq('id', leadId)
      .maybeSingle();

    if (leadFetchErr) {
      throw new Error(`ไม่สามารถตรวจสอบข้อมูลลูกค้าได้: ${leadFetchErr.message}`);
    }
    if (!lead) {
      throw new Error('ไม่พบข้อมูลลูกค้าในระบบ หรือข้อมูลถูกลบไปแล้ว');
    }

    customerName = lead.customer_name;

    // 2. Fetch ALL sales and rental contracts for this lead (strict error checks)
    const { data: salesRecords, error: salesErr } = await supabase
      .from('sales')
      .select('id, plot_id, contract_status, crm_stage')
      .eq('lead_id', leadId);
    if (salesErr) {
      throw new Error(`ไม่สามารถตรวจสอบประวัติการขายของลูกค้าได้: ${salesErr.message}`);
    }

    const { data: rentalContracts, error: rcErr } = await supabase
      .from('rental_contracts')
      .select('id, plot_id, project_name, status')
      .eq('lead_id', leadId);
    if (rcErr) {
      throw new Error(`ไม่สามารถตรวจสอบประวัติสัญญาเช่าของลูกค้าได้: ${rcErr.message}`);
    }

    const salesList = Array.isArray(salesRecords) ? salesRecords : [];
    const contractList = Array.isArray(rentalContracts) ? rentalContracts : [];

    // 3. BLOCK DELETION if this customer STILL has an active/pending rental or active purchase deal!
    const activeOrPendingContracts = contractList.filter(
      c => !ENDED_CONTRACT_STATUSES.has(normalizeText(c.status))
    );
    const activeSales = salesList.filter(isSaleActive);
    const dealClass = classifySalesDeal(lead);

    if (
      activeOrPendingContracts.length > 0 ||
      dealClass.isRentalPending ||
      dealClass.isRentalActive
    ) {
      return {
        success: false,
        leadId,
        customerName,
        releasedPlotIds,
        skippedPlotIds,
        deletedPaymentsCount,
        deletedContractsCount,
        error:
          'ไม่สามารถลบลูกค้ารายนี้ได้ เนื่องจากยังมีรายการจองเช่าหรือสัญญาเช่าที่กำลังดำเนินการอยู่ กรุณายกเลิกจองเช่าหรือทำรายการย้ายออกตามขั้นตอนก่อนลบข้อมูล',
        errorCode: 'ACTIVE_RENTAL_BLOCKED',
      };
    }

    if (activeSales.length > 0 || isLegacyPurchaseLeadHolder(lead)) {
      return {
        success: false,
        leadId,
        customerName,
        releasedPlotIds,
        skippedPlotIds,
        deletedPaymentsCount,
        deletedContractsCount,
        error:
          'ไม่สามารถลบลูกค้ารายนี้ได้ เนื่องจากยังมีรายการจองซื้อ/สัญญาซื้อขายที่ยังไม่ถูกยกเลิก กรุณายกเลิกรายการขายตามขั้นตอนก่อนลบข้อมูล',
        errorCode: 'ACTIVE_SALE_BLOCKED',
      };
    }

    if (dealClass.isConflict) {
      return {
        success: false,
        leadId,
        customerName,
        releasedPlotIds,
        skippedPlotIds,
        deletedPaymentsCount,
        deletedContractsCount,
        error:
          'ข้อมูลสถานะซื้อ/เช่าของลูกค้าขัดแย้งกัน ไม่สามารถลบอัตโนมัติได้ กรุณาตรวจสอบและแก้ไขสถานะก่อน',
        errorCode: 'CONFLICTING_STATE_BLOCKED',
      };
    }

    // 4. Inspect candidate plots strictly scoped by project & canonical plot ID
    const candidatePlotIds = new Set<string>();
    if (lead.interested_plot_id) candidatePlotIds.add(lead.interested_plot_id);
    if (fallbackPlotId) candidatePlotIds.add(fallbackPlotId);
    salesList.forEach(s => {
      if (s.plot_id) candidatePlotIds.add(s.plot_id);
    });
    contractList.forEach(c => {
      if (c.plot_id) candidatePlotIds.add(c.plot_id);
    });

    const leadProject = normalizeText(lead.project_name);

    for (const pId of candidatePlotIds) {
      let plotQuery = supabase
        .from('plots')
        .select(
          'id, project_name, plot_name, has_customer, sale_status, current_tenant_name, current_tenant_phone, rental_program, monthly_rent, security_deposit, lease_start_date, lease_end_date, highlight_note'
        )
        .eq('id', pId);
      if (leadProject) {
        plotQuery = plotQuery.eq('project_name', leadProject);
      }

      const { data: plotRow, error: plotFetchErr } = await plotQuery.maybeSingle();
      if (plotFetchErr) {
        throw new Error(`ตรวจสอบสถานะแปลง ${pId} ไม่สำเร็จ: ${plotFetchErr.message}`);
      }
      if (!plotRow) {
        // Plot does not exist or belongs to another project -> skip safely
        skippedPlotIds.push(pId);
        continue;
      }

      // If plot is already completely vacant, no plot release needed
      if (!plotHasLegacyOccupancyOrRentalData(plotRow)) {
        continue;
      }

      const plotStatusLower = normalizeText(plotRow.sale_status).toLowerCase();
      if (TRANSFERRED_PLOT_STATUSES.has(plotStatusLower)) {
        // Transferred plot belongs to a completed ownership transfer -> NEVER touch
        skippedPlotIds.push(plotRow.id);
        continue;
      }

      // Check CURRENT holders on this plot (other buyers, other tenants, other pending leads)
      const { data: plotSales, error: plotSalesErr } = await supabase
        .from('sales')
        .select('id, lead_id, contract_status, crm_stage')
        .eq('plot_id', plotRow.id);
      if (plotSalesErr) {
        throw new Error(`ตรวจสอบผู้ถือสิทธิ์ซื้อบนแปลง ${plotRow.id} ไม่สำเร็จ: ${plotSalesErr.message}`);
      }

      const { data: plotContracts, error: plotContractsErr } = await supabase
        .from('rental_contracts')
        .select('id, lead_id, status')
        .eq('plot_id', plotRow.id);
      if (plotContractsErr) {
        throw new Error(`ตรวจสอบสัญญาเช่าบนแปลง ${plotRow.id} ไม่สำเร็จ: ${plotContractsErr.message}`);
      }

      const { data: otherLeadsById, error: otherLeadsErr } = await supabase
        .from('leads')
        .select('id, project_name, interested_plot_id, interested_plot_name, status, crm_status, rental_status, deal_type, active_rental_contract_id')
        .eq('interested_plot_id', plotRow.id)
        .neq('id', leadId);
      if (otherLeadsErr) {
        throw new Error(`ตรวจสอบลูกค้ารายอื่นบนแปลง ${plotRow.id} ไม่สำเร็จ: ${otherLeadsErr.message}`);
      }

      const otherLeadsMap = new Map<string, Record<string, any>>();
      for (const row of otherLeadsById || []) {
        if (row?.id) otherLeadsMap.set(row.id, row);
      }

      // Also check legacy bare plot_name references in the same/missing project so ambiguous
      // name-only purchase/rental holders NEVER get wiped during legacy plot release!
      const plotNameKey = normalizeText(plotRow.plot_name);
      if (plotNameKey && plotNameKey !== plotRow.id) {
        const { data: otherLeadsByName, error: otherLeadsNameErr } = await supabase
          .from('leads')
          .select('id, project_name, interested_plot_id, interested_plot_name, status, crm_status, rental_status, deal_type, active_rental_contract_id')
          .eq('interested_plot_name', plotNameKey)
          .neq('id', leadId);
        if (otherLeadsNameErr) {
          throw new Error(`ตรวจสอบลูกค้ารายอื่น (ชื่อแปลง ${plotNameKey}) ไม่สำเร็จ: ${otherLeadsNameErr.message}`);
        }
        for (const row of otherLeadsByName || []) {
          if (row?.id) otherLeadsMap.set(row.id, row);
        }

        const { data: otherLeadsByPlotIdAlias, error: otherLeadsAliasErr } = await supabase
          .from('leads')
          .select('id, project_name, interested_plot_id, interested_plot_name, status, crm_status, rental_status, deal_type, active_rental_contract_id')
          .eq('interested_plot_id', plotNameKey)
          .neq('id', leadId);
        if (otherLeadsAliasErr) {
          throw new Error(`ตรวจสอบลูกค้ารายอื่น (รหัสแปลงเดิม ${plotNameKey}) ไม่สำเร็จ: ${otherLeadsAliasErr.message}`);
        }
        for (const row of otherLeadsByPlotIdAlias || []) {
          if (row?.id) otherLeadsMap.set(row.id, row);
        }
      }

      const hasCurrentSaleHolder = (plotSales || []).some(isSaleActive);
      const hasCurrentContractHolder = (plotContracts || []).some(
        c => !ENDED_CONTRACT_STATUSES.has(normalizeText(c.status))
      );
      const hasCurrentOtherLeadHolder = Array.from(otherLeadsMap.values()).some(other => {
        const refMatch = matchLeadPlotReference(other, plotRow);
        if (refMatch === 'none') return false;
        const cls = classifySalesDeal(other);
        const isPurchaseHolder = isLegacyPurchaseLeadHolder(other);
        return cls.isRentalPending || cls.isRentalActive || cls.isConflict || isPurchaseHolder;
      });

      if (hasCurrentSaleHolder || hasCurrentContractHolder || hasCurrentOtherLeadHolder) {
        // Plot is currently owned/held (or ambiguously referenced) by another buyer/tenant -> NEVER release or clear it!
        skippedPlotIds.push(plotRow.id);
        continue;
      }

      // Require verifiable vacating/ended deal history on this plot before attempting legacy release
      const leadStatusLower = normalizeText(lead.status).toLowerCase();
      const leadRentalLower = normalizeText(lead.rental_status).toLowerCase();
      const leadIsVacatedCanonical =
        matchLeadPlotReference(lead, plotRow) === 'canonical' &&
        (['cancelled', 'canceled', 'movedout'].includes(leadStatusLower) ||
          ['cancelled', 'canceled', 'movedout', 'expired'].includes(leadRentalLower));
      const hasEndedContractHistory = (plotContracts || []).some(c =>
        VACATING_ENDED_CONTRACT_STATUSES.has(normalizeText(c.status))
      );
      const hasCancelledSaleHistory = (plotSales || []).some(s => !isSaleActive(s));

      if (!leadIsVacatedCanonical && !hasEndedContractHistory && !hasCancelledSaleHistory) {
        skippedPlotIds.push(plotRow.id);
        continue;
      }

      // Only release legacy leftover plot occupancy via the guard-approved RPC (NEVER direct plots.update!).
      // If this RPC fails, ABORT customer deletion immediately!
      const plotProject = normalizeText(plotRow.project_name) || leadProject;
      if (!plotProject) {
        throw new Error(
          `ไม่พบชื่อโครงการของแปลง ${plotRow.id} จึงไม่สามารถคืนแปลงผ่านคำสั่งที่ได้รับอนุญาตได้ (ยกเลิกการลบลูกค้าเพื่อความปลอดภัย)`
        );
      }

      try {
        const releaseRes = await releaseLegacyPlotTx({
          requestId: options.requestId || createTxRequestId(),
          actorRole: options.actorRole,
          projectName: plotProject,
          plotId: plotRow.id,
          expectedHasCustomer: Boolean(plotRow.has_customer),
          expectedSaleStatus: normalizeText(plotRow.sale_status),
          reason: `Legacy plot cleanup before admin deletion of ended lead ${leadId}`,
          leadId,
        });
        if (releaseRes.plotReleased) {
          releasedPlotIds.push(plotRow.id);
        }
      } catch (releaseErr) {
        const txErr = translateSalesTxError(releaseErr);
        return {
          success: false,
          leadId,
          customerName,
          releasedPlotIds,
          skippedPlotIds,
          deletedPaymentsCount,
          deletedContractsCount,
          error: `ไม่สามารถคืนแปลง ${plotRow.plot_name || plotRow.id} ได้ จึงระงับการลบลูกค้าไว้เพื่อป้องกันข้อมูลค้าง: ${txErr.message}`,
          errorCode: txErr.code,
        };
      }
    }

    // 5. Delete child records strictly checking errors at every step (no silent swallow!)
    const contractIds = contractList.map(c => c.id);

    if (contractIds.length > 0) {
      const orFilter = `lead_id.eq.${leadId},contract_id.in.(${contractIds.join(',')})`;
      const { data: deletedPay, error: payErr } = await supabase
        .from('rental_payments')
        .delete()
        .or(orFilter)
        .select('id');
      if (payErr) throw new Error(`ลบประวัติการชำระค่าเช่าไม่สำเร็จ: ${payErr.message}`);
      deletedPaymentsCount = deletedPay?.length || 0;
    } else {
      const { data: deletedPay, error: payErr } = await supabase
        .from('rental_payments')
        .delete()
        .eq('lead_id', leadId)
        .select('id');
      if (payErr) throw new Error(`ลบประวัติการชำระค่าเช่าไม่สำเร็จ: ${payErr.message}`);
      deletedPaymentsCount = deletedPay?.length || 0;
    }

    if (contractIds.length > 0) {
      const { error: delContractErr } = await supabase
        .from('rental_contracts')
        .delete()
        .eq('lead_id', leadId);
      if (delContractErr) throw new Error(`ลบประวัติสัญญาเช่าไม่สำเร็จ: ${delContractErr.message}`);
      deletedContractsCount = contractIds.length;
    }

    if (salesList.length > 0) {
      const { error: delSalesErr } = await supabase
        .from('sales')
        .delete()
        .eq('lead_id', leadId);
      if (delSalesErr) throw new Error(`ลบประวัติรายการขายไม่สำเร็จ: ${delSalesErr.message}`);
    }

    // Optional satellite tables (ignore only "relation does not exist" 42P01, surface all real DB/RLS errors!)
    const deleteOptionalChild = async (table: string, column: string) => {
      const { error } = await supabase.from(table).delete().eq(column, leadId);
      if (error) {
        const code = String((error as any).code || '');
        const msg = String(error.message || '');
        if (code === '42P01' || msg.includes('does not exist') || code === 'PGRST205') {
          return;
        }
        throw new Error(`ลบข้อมูลในตาราง ${table} ไม่สำเร็จ: ${msg}`);
      }
    };

    await deleteOptionalChild('lead_activities', 'lead_id');
    await deleteOptionalChild('lead_follow_ups', 'lead_id');
    await deleteOptionalChild('customer_survey_responses', 'lead_id');
    await deleteOptionalChild('status_history', 'entity_id');

    // 6. Finally delete the lead row
    const { error: leadDelErr } = await supabase
      .from('leads')
      .delete()
      .eq('id', leadId);

    if (leadDelErr) {
      throw new Error(`ลบข้อมูลลูกค้าออกจากตาราง leads ไม่สำเร็จ: ${leadDelErr.message}`);
    }

    if (typeof window !== 'undefined') {
      broadcastSalesSync({
        type: 'customer_deleted',
        leadId,
        projectName: leadProject || null,
        timestamp: Date.now(),
      });
    }

    return {
      success: true,
      leadId,
      customerName,
      releasedPlotIds,
      skippedPlotIds,
      deletedPaymentsCount,
      deletedContractsCount,
    };
  } catch (err: any) {
    console.error('[deleteCustomerWithCascade] Error:', err);
    return {
      success: false,
      leadId,
      customerName,
      releasedPlotIds,
      skippedPlotIds,
      deletedPaymentsCount,
      deletedContractsCount,
      error: err?.message || 'เกิดข้อผิดพลาดในการลบข้อมูลลูกค้า',
    };
  }
}

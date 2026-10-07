import { supabase } from './supabase';

export interface DeleteCustomerResult {
  success: boolean;
  leadId: string;
  customerName?: string;
  releasedPlotIds: string[];
  deletedContractsCount: number;
  deletedPaymentsCount: number;
  error?: string;
}

/**
 * Safely deletes a customer/lead and all associated records across Supabase tables with full cascade cleanup:
 * 1. Finds all linked plot IDs (interested_plot_id, sales.plot_id, rental_contracts.plot_id).
 * 2. Releases and resets all linked plots to 'Available' (clearing tenant/booking/customer info).
 * 3. Deletes associated rental_payments.
 * 4. Deletes associated rental_contracts.
 * 5. Deletes associated customer_voices (surveys).
 * 6. Deletes associated lead_activities & status_history.
 * 7. Deletes associated sales records.
 * 8. Deletes the lead from `leads` table.
 */
export async function deleteCustomerWithCascade(
  leadId: string,
  explicitPlotId?: string | null
): Promise<DeleteCustomerResult> {
  const releasedPlotIds: string[] = [];
  let deletedContractsCount = 0;
  let deletedPaymentsCount = 0;
  let customerName = '';

  try {
    // 1. Fetch Lead info to find plot and customer name
    const { data: leadData } = await supabase
      .from('leads')
      .select('id, customer_name, interested_plot_id, interested_plot_name, project_name')
      .eq('id', leadId)
      .maybeSingle();

    if (leadData?.customer_name) {
      customerName = leadData.customer_name;
    }

    // Collect all plot IDs linked to this lead
    const plotIdSet = new Set<string>();
    if (explicitPlotId) plotIdSet.add(explicitPlotId);
    if (leadData?.interested_plot_id) plotIdSet.add(leadData.interested_plot_id);

    // 2. Fetch Sales attached to this lead
    const { data: salesData } = await supabase
      .from('sales')
      .select('id, plot_id')
      .eq('lead_id', leadId);

    if (salesData && salesData.length > 0) {
      salesData.forEach(s => {
        if (s.plot_id) plotIdSet.add(s.plot_id);
      });
    }

    // 3. Fetch Rental Contracts attached to this lead
    const { data: contractsData } = await supabase
      .from('rental_contracts')
      .select('id, plot_id')
      .eq('lead_id', leadId);

    if (contractsData && contractsData.length > 0) {
      deletedContractsCount = contractsData.length;
      contractsData.forEach(c => {
        if (c.plot_id) plotIdSet.add(c.plot_id);
      });
    }

    // 4. Release & Reset all linked plots back to Available
    const plotIdsToRelease = Array.from(plotIdSet);
    for (const pId of plotIdsToRelease) {
      if (!pId) continue;
      
      const { error: plotUpdateErr } = await supabase
        .from('plots')
        .update({
          sale_status: 'Available',
          has_customer: false,
          current_tenant_name: null,
          current_tenant_phone: null,
          rental_program: null,
          monthly_rent: null,
          security_deposit: null,
          accumulated_downpayment: 0,
          lease_start_date: null,
          lease_end_date: null,
          highlight_note: null,
          paused_for_sale_at: null
        })
        .or(`id.eq.${pId},plot_name.eq.${pId}`);

      if (!plotUpdateErr) {
        releasedPlotIds.push(pId);
      }
    }

    // 5. Delete Rental Payments attached to lead or its contracts
    const contractIds = contractsData?.map(c => c.id) || [];
    if (contractIds.length > 0) {
      const { data: delPayData } = await supabase
        .from('rental_payments')
        .delete()
        .or(`lead_id.eq.${leadId},contract_id.in.(${contractIds.join(',')})`)
        .select('id');
      deletedPaymentsCount = delPayData?.length || 0;
    } else {
      const { data: delPayData } = await supabase
        .from('rental_payments')
        .delete()
        .eq('lead_id', leadId)
        .select('id');
      deletedPaymentsCount = delPayData?.length || 0;
    }

    // 6. Delete Rental Contracts
    if (contractsData && contractsData.length > 0) {
      await supabase
        .from('rental_contracts')
        .delete()
        .eq('lead_id', leadId);
    }

    // 7. Delete Customer Voices (Surveys)
    try {
      await supabase
        .from('customer_voices')
        .delete()
        .eq('lead_id', leadId);
    } catch (ignore) {
      // Table might not have RLS delete or may not exist in some environments
    }

    // 8. Delete Status History & Lead Activities
    try {
      if (salesData && salesData.length > 0) {
        for (const s of salesData) {
          await supabase.from('status_history').delete().eq('entity_id', s.id);
        }
      }
      await supabase.from('status_history').delete().eq('entity_id', leadId);
    } catch (ignore) {}

    try {
      await supabase
        .from('lead_activities')
        .delete()
        .eq('lead_id', leadId);
    } catch (ignore) {}

    // 9. Delete Sales
    if (salesData && salesData.length > 0) {
      await supabase
        .from('sales')
        .delete()
        .eq('lead_id', leadId);
    }

    // 10. Finally, delete the Lead itself
    const { error: deleteLeadErr } = await supabase
      .from('leads')
      .delete()
      .eq('id', leadId);

    if (deleteLeadErr) {
      throw deleteLeadErr;
    }

    return {
      success: true,
      leadId,
      customerName,
      releasedPlotIds,
      deletedContractsCount,
      deletedPaymentsCount
    };
  } catch (err: any) {
    console.error('Error during cascade customer deletion:', err);
    return {
      success: false,
      leadId,
      customerName,
      releasedPlotIds,
      deletedContractsCount,
      deletedPaymentsCount,
      error: err.message || 'เกิดข้อผิดพลาดในการลบข้อมูลลูกค้า'
    };
  }
}

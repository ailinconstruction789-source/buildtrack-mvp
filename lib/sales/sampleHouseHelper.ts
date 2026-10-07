import { supabase } from '@/lib/supabase';

export interface SampleHouseInspectionStatus {
  isSampleHouse: boolean;
  status: 'morning_checked' | 'evening_checked' | 'pending';
  badgeLabel: string;
  badgeColor: string;
  badgeBg: string;
  icon: 'sun' | 'moon' | 'alert';
  inspectorName?: string;
  inspectionTime?: string;
  rawDate?: string;
  notes?: string;
}

/** Check if a plot is designated as a sample house (บ้านตัวอย่าง) */
export function isSampleHouse(plot: any): boolean {
  if (!plot) return false;
  // If plot is transferred, sold, or has customer, it cannot be an active sample house
  if (plot.has_customer === true) return false;
  const status = (plot.sale_status || '').toLowerCase();
  if (['transferred', 'sold', 'handover', 'contracted', 'reserved', 'booked', 'downpayment'].includes(status)) {
    return false;
  }

  return (
    plot.is_sample_house === true ||
    plot.sale_status === 'sample_house' ||
    plot.sale_status === 'sample' ||
    plot.highlight_note === 'sample_house' ||
    Boolean(plot.plot_name?.includes('บ้านตัวอย่าง')) ||
    Boolean(plot.id?.includes('บ้านตัวอย่าง'))
  );
}

/** Check if a plot is eligible to be designated as a sample house (must be vacant/available) */
export function isPlotEligibleForSampleHouse(
  plot: any,
  activeLead?: any,
  salesStatus?: string
): { eligible: boolean; reason?: string } {
  if (!plot) return { eligible: false, reason: 'ไม่พบข้อมูลแปลง' };

  if (plot.has_customer === true) {
    return { eligible: false, reason: 'แปลงนี้มีลูกค้าจองหรือโอนกรรมสิทธิ์แล้ว' };
  }

  const plotStatus = (plot.sale_status || salesStatus || '').toLowerCase();
  const occupiedStatuses = [
    'transferred', 'sold', 'handover', 'contracted', 
    'reserved', 'booked', 'downpayment', 'document_prep', 
    'loan_processing', 'loan_approved', 'approved'
  ];

  if (occupiedStatuses.includes(plotStatus)) {
    const isTransferred = ['transferred', 'sold', 'handover'].includes(plotStatus);
    return {
      eligible: false,
      reason: isTransferred 
        ? 'แปลงนี้โอนกรรมสิทธิ์แล้ว ไม่สามารถตั้งเป็นบ้านตัวอย่างได้' 
        : 'แปลงนี้มีการจอง/ทำสัญญาแล้ว ไม่สามารถตั้งเป็นบ้านตัวอย่างได้'
    };
  }

  if (activeLead && activeLead.status !== 'Available' && activeLead.status !== 'Cancelled' && activeLead.status !== 'Visit') {
    return {
      eligible: false,
      reason: `แปลงนี้มีลูกค้าจอง/ผูกสัญญาอยู่ (${activeLead.status}) ไม่สามารถตั้งเป็นบ้านตัวอย่างได้`
    };
  }

  return { eligible: true };
}

/** Toggle a plot as sample house in Supabase */
export async function toggleSampleHouse(
  plotId: string, 
  isSample: boolean, 
  currentPlot?: any,
  activeLead?: any
): Promise<{ success: boolean; error?: string }> {
  try {
    if (isSample) {
      const check = isPlotEligibleForSampleHouse(currentPlot, activeLead);
      if (!check.eligible) {
        return { success: false, error: check.reason };
      }
    }

    const payload: any = {
      highlight_note: isSample ? 'sample_house' : null
    };

    if (isSample) {
      if (!currentPlot?.sale_status || currentPlot?.sale_status === 'available') {
        payload.sale_status = 'sample_house';
      }
    } else {
      if (currentPlot?.sale_status === 'sample_house') {
        payload.sale_status = 'available';
      }
    }

    // Attempt update
    const { error } = await supabase.from('plots').update(payload).eq('id', plotId);
    if (error) {
      // Fallback update without sale_status if constraint occurs
      await supabase.from('plots').update({ highlight_note: isSample ? 'sample_house' : null }).eq('id', plotId);
    }
    return { success: true };
  } catch (err: any) {
    console.error('Error toggling sample house:', err);
    return { success: false, error: err.message || 'เกิดข้อผิดพลาดในการบันทึก' };
  }
}

/** Fetch map of today's inspection status for all plots in a project */
export async function fetchTodayInspectionMap(
  projectName: string
): Promise<Record<string, SampleHouseInspectionStatus>> {
  const result: Record<string, SampleHouseInspectionStatus> = {};
  try {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const { data, error } = await supabase
      .from('house_visit_checklists')
      .select('*')
      .is('lead_id', null)
      .eq('project_name', projectName)
      .order('created_at', { ascending: false })
      .limit(30);

    if (error || !data) return result;

    const todayLogs = data.filter(log => {
      if (!log.created_at) return false;
      const logDate = new Date(log.created_at);
      const logDateStr = `${logDate.getFullYear()}-${String(logDate.getMonth() + 1).padStart(2, '0')}-${String(logDate.getDate()).padStart(2, '0')}`;
      return logDateStr === todayStr;
    });

    for (const log of todayLogs) {
      const isEvening = log.stage === 'daily_routine_evening' || log.customer_name?.includes('รอบเย็น');
      const timeStr = new Date(log.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
      const target = log.house_or_plot_name || 'general';

      const statusObj: SampleHouseInspectionStatus = isEvening ? {
        isSampleHouse: true,
        status: 'evening_checked',
        badgeLabel: `🌙 ปิดบ้านแล้ว (${timeStr})`,
        badgeColor: 'text-indigo-800',
        badgeBg: 'bg-indigo-100 border-indigo-300',
        icon: 'moon',
        inspectorName: log.agent_name,
        inspectionTime: timeStr,
        rawDate: log.created_at,
        notes: log.customer_feedback
      } : {
        isSampleHouse: true,
        status: 'morning_checked',
        badgeLabel: `☀️ เปิดบ้านแล้ว (${timeStr})`,
        badgeColor: 'text-emerald-800',
        badgeBg: 'bg-emerald-100 border-emerald-300',
        icon: 'sun',
        inspectorName: log.agent_name,
        inspectionTime: timeStr,
        rawDate: log.created_at,
        notes: log.customer_feedback
      };

      if (!result[target]) {
        result[target] = statusObj;
      }
    }
  } catch (err) {
    console.error('Error fetching inspection map:', err);
  }
  return result;
}

/** Fetch today's inspection status for a project or sample house plot */
export async function fetchTodayInspectionStatus(
  projectName: string,
  plotName?: string
): Promise<SampleHouseInspectionStatus> {
  try {
    const map = await fetchTodayInspectionMap(projectName);
    
    // Exact match for plotName
    if (plotName && map[plotName]) {
      return map[plotName];
    }

    // Partial match in keys
    if (plotName) {
      for (const [key, val] of Object.entries(map)) {
        if (key.includes(plotName) || plotName.includes(key)) {
          return val;
        }
      }
    }

    // Fallback to general inspection or first inspection
    if (map['general']) return map['general'];
    if (map['บ้านตัวอย่าง / สำนักงานขาย']) return map['บ้านตัวอย่าง / สำนักงานขาย'];
    const anyKey = Object.keys(map)[0];
    if (anyKey && map[anyKey]) return map[anyKey];

    return {
      isSampleHouse: true,
      status: 'pending',
      badgeLabel: '⚠️ รอตรวจเปิดบ้าน',
      badgeColor: 'text-amber-700',
      badgeBg: 'bg-amber-100 border-amber-300',
      icon: 'alert'
    };
  } catch (err) {
    console.error('Error fetching today inspection status:', err);
    return {
      isSampleHouse: true,
      status: 'pending',
      badgeLabel: '⚠️ รอตรวจเปิดบ้าน',
      badgeColor: 'text-amber-700',
      badgeBg: 'bg-amber-100 border-amber-300',
      icon: 'alert'
    };
  }
}

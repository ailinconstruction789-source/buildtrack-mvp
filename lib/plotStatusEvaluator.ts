export interface PlotSaleAndInspectionStatus {
  isReadyForSale: boolean;
  isReadyForCustomerInspection: boolean;
  isFullyCompletedStock: boolean;
  isTransferred: boolean;
  countedTasksTotal: number;
  countedTasksPassedQC: number;
  uncountedTasksTotal: number;
  uncountedTasksPassedQC: number;
  badgeLabel: string | null;
  badgeType: 'transferred' | 'ready_for_customer' | 'completed_stock' | 'ready_for_sale' | null;
  colorTheme: {
    status: string;
    label: string;
    colors: string;
  };
}

export function evaluatePlotCompletionAndSaleStatus({
  plot,
  taskTemplates,
  assignments,
  latestUpdatesMap,
  allUpdatesRecord = [],
}: {
  plot: any;
  taskTemplates: any[];
  assignments: any[];
  latestUpdatesMap: { [key: string]: any };
  allUpdatesRecord?: any[];
}): PlotSaleAndInspectionStatus {
  if (!plot) {
    return {
      isReadyForSale: false,
      isReadyForCustomerInspection: false,
      isFullyCompletedStock: false,
      isTransferred: false,
      countedTasksTotal: 0,
      countedTasksPassedQC: 0,
      uncountedTasksTotal: 0,
      uncountedTasksPassedQC: 0,
      badgeLabel: null,
      badgeType: null,
      colorTheme: {
        status: 'none',
        label: 'รอดำเนินการ',
        colors: 'bg-white/90 border-slate-300 text-slate-500',
      },
    };
  }

  // 👑 ระดับสูงสุด: โอนกรรมสิทธิ์แล้ว (is_completed = true หรือ sale_status = 'transferred')
  const isTransferred = Boolean(plot.is_completed) || plot.sale_status === 'transferred';

  const plotTasks = taskTemplates.filter((t) => t.house_type_id === plot.house_type_id);
  const isQCApproved = (act: string) => act.includes('อนุมัติ') || act.includes('ผ่าน');

  let countedTasksTotal = 0;
  let countedTasksPassedQC = 0;

  let uncountedTasksTotal = 0;
  let uncountedTasksPassedQC = 0;

  for (const task of plotTasks) {
    const key = `${plot.id}-${task.id}`;
    const assign = assignments.find((a) => a.plot_id === plot.id && a.task_template_id === task.id);
    const isExcluded = assign?.is_excluded || false;

    // ข้ามงานที่เป็นข้อยกเว้น N/A ของแปลงนี้
    if (isExcluded) continue;

    // หา Progress ของงาน
    const tProgress = assign ? assign.current_progress : (latestUpdatesMap[key]?.progress || 0);

    // หาประวัติ QC Update ล่าสุด
    const updates = allUpdatesRecord.filter((u: any) => u.plot_id === plot.id && u.task_template_id === task.id);
    let latestQCUpdate = null;
    for (let i = updates.length - 1; i >= 0; i--) {
      const u = updates[i];
      const act = u.action || '';
      const role = u.role || '';
      if (act.includes('QC') || role === 'QC') {
        latestQCUpdate = u;
        break;
      }
    }
    const mapRole = latestUpdatesMap[key]?.role;
    const mapAction = latestUpdatesMap[key]?.action || '';
    if (!latestQCUpdate && (mapRole === 'QC' || mapAction.includes('QC'))) {
      latestQCUpdate = latestUpdatesMap[key];
    }

    // ตรวจสอบว่าผ่าน QC หรือไม่
    let qcPassed = false;
    if (tProgress === 100) {
      if (task.require_qc === false) {
        qcPassed = true;
      } else if (isQCApproved(mapAction) || (latestQCUpdate && isQCApproved(latestQCUpdate.action || ''))) {
        qcPassed = true;
      } else if (mapAction !== 'ส่งงาน 100%' && mapRole !== 'Foreman' && (!latestQCUpdate || !latestQCUpdate.action.includes('แจ้งแก้ไข'))) {
        if (latestQCUpdate && isQCApproved(latestQCUpdate.action)) {
          qcPassed = true;
        }
      }
    }

    const isCounted = task.is_progress_counted !== false;
    if (isCounted) {
      countedTasksTotal++;
      if (qcPassed) countedTasksPassedQC++;
    } else {
      uncountedTasksTotal++;
      if (qcPassed) uncountedTasksPassedQC++;
    }
  }

  // เงื่อนไข 1: บ้านพร้อมขาย (งานที่คำนวณในแผนเสร็จ 100% ทุกงาน + ผ่าน QC ทุกงาน)
  const isReadyForSale = countedTasksTotal > 0 && countedTasksPassedQC === countedTasksTotal;

  // เงื่อนไข 2: งานกลุ่มที่ไม่นำมาคำนวณในแผนผ่าน QC ครบ 100% ทุกงานด้วย
  const isUncountedAllPassed = uncountedTasksTotal === 0 || uncountedTasksPassedQC === uncountedTasksTotal;

  // ขั้นสูงกว่า:
  const isFullCompleted = isReadyForSale && isUncountedAllPassed;
  const hasCustomer = Boolean(plot.has_customer);

  let badgeLabel: string | null = null;
  let badgeType: 'transferred' | 'ready_for_customer' | 'completed_stock' | 'ready_for_sale' | null = null;

  // ธีมสีใหม่:
  // 1. โอนแล้ว = สีทอง (Gold/Amber) 👑
  // 2. พร้อมให้ลูกค้าตรวจ = สีเขียวเข้มมรกต (Emerald 600/700) 📋
  // 3. บ้านสร้างเสร็จสมบูรณ์ = สีเขียว (Emerald) 🏆
  // 4. บ้านพร้อมขาย = สีฟ้าอมเขียว/น้ำเงินเทา (Cyan/Indigo) 🏷️
  let colorTheme = {
    status: 'none',
    label: 'รอดำเนินการ',
    colors: 'bg-white/90 border-slate-300 text-slate-500',
  };

  if (isTransferred) {
    badgeLabel = 'โอนกรรมสิทธิ์แล้ว';
    badgeType = 'transferred';
    colorTheme = {
      status: 'transferred',
      label: 'โอนกรรมสิทธิ์แล้ว',
      colors: 'bg-amber-100/90 border-amber-500 text-amber-800 shadow-[0_0_10px_rgba(245,158,11,0.3)]',
    };
  } else if (isFullCompleted) {
    if (hasCustomer) {
      badgeLabel = 'พร้อมให้ลูกค้าตรวจ';
      badgeType = 'ready_for_customer';
      colorTheme = {
        status: 'ready_for_customer',
        label: 'พร้อมให้ลูกค้าตรวจ',
        colors: 'bg-emerald-100/90 border-emerald-600 text-emerald-900 shadow-[0_0_10px_rgba(5,150,105,0.3)]',
      };
    } else {
      badgeLabel = 'บ้านสร้างเสร็จสมบูรณ์';
      badgeType = 'completed_stock';
      colorTheme = {
        status: 'completed',
        label: 'เสร็จสมบูรณ์',
        colors: 'bg-emerald-50 border-emerald-500 text-emerald-800',
      };
    }
  } else if (isReadyForSale) {
    badgeLabel = 'บ้านพร้อมขาย';
    badgeType = 'ready_for_sale';
    colorTheme = {
      status: 'ready_for_sale',
      label: 'พร้อมขาย',
      colors: 'bg-cyan-50 border-cyan-500 text-cyan-800',
    };
  }

  return {
    isReadyForSale,
    isReadyForCustomerInspection: isFullCompleted && hasCustomer,
    isFullyCompletedStock: isFullCompleted && !hasCustomer,
    isTransferred,
    countedTasksTotal,
    countedTasksPassedQC,
    uncountedTasksTotal,
    uncountedTasksPassedQC,
    badgeLabel,
    badgeType,
    colorTheme,
  };
}

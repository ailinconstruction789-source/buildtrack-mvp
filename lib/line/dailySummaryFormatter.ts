import type {
  DailySummaryReport,
  ProjectConstructionMetrics,
  TransferScheduleItem,
} from './dailySummaryTypes';
import { formatThaiShortDate } from './bangkokDate';

function fmtPct(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

function fmtSignedPct(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded > 0 ? '+' : '';
  return Number.isInteger(rounded) ? `${sign}${rounded}%` : `${sign}${rounded.toFixed(1)}%`;
}

function formatTransferReadiness(item: TransferScheduleItem): string {
  if (item.isTransferredToday) {
    return 'โอนสำเร็จ ✅';
  }
  const issues: string[] = [];
  if (item.openDefectsCount > 0) {
    issues.push(`รอแก้ Defect ${item.openDefectsCount} รายการ`);
  }
  if (!item.isHouseReady && item.houseProgressPct < 100) {
    issues.push(`งานก่อสร้าง ${fmtPct(item.houseProgressPct)}`);
  }
  if (item.bankStatus && /pending|reject/i.test(item.bankStatus)) {
    issues.push(`แบงก์: ${item.bankStatus}`);
  }
  if (issues.length === 0) {
    return 'บ้านพร้อมโอน ✅';
  }
  return issues.join(', ');
}

function formatConstructionBlock(
  c: ProjectConstructionMetrics,
  headerLabel = '🏗️ ฝั่งก่อสร้าง',
): string[] {
  const lines: string[] = [headerLabel];

  const varianceIcon = c.variancePct >= 0 ? '✅' : c.variancePct <= -5 ? '🔴' : '🟡';
  lines.push(
    `• ความก้าวหน้าวันนี้: ${fmtSignedPct(c.todayDeltaPct)} | สะสม: ${fmtPct(c.actualProgressPct)} (แผน ${fmtPct(c.plannedProgressPct)} | ${fmtSignedPct(c.variancePct)} ${varianceIcon})`,
  );

  lines.push(
    `• หน้างานวันนี้: มีช่างเข้า ${c.plotsWithWorkersToday} แปลง | ไม่มีช่างเข้า ${c.plotsWithoutWorkersToday} แปลง | ล่าช้า ${c.delayedPlots} แปลง`,
  );

  lines.push(
    `• QC วันนี้: เข้าใหม่ ${c.qcEnteredToday} | ตรวจแล้ว ${c.qcInspectedToday} (ผ่าน ${c.qcPassedToday} / แก้ไข ${c.qcRejectedToday})`,
  );

  const backlogDetails: string[] = [];
  if (c.qcBacklogOverdue3Days > 0) {
    backlogDetails.push(`ค้าง >3 วัน: ${c.qcBacklogOverdue3Days}`);
  }
  if (c.pePendingCount > 0) {
    backlogDetails.push(`รอ PE: ${c.pePendingCount}`);
  }
  if (c.sePendingCount > 0) {
    backlogDetails.push(`รอ SE: ${c.sePendingCount}`);
  }
  if (c.reworkPendingCount > 0) {
    backlogDetails.push(`รอแก้ Rework: ${c.reworkPendingCount}`);
  }

  const backlogSuffix = backlogDetails.length > 0 ? ` (${backlogDetails.join(' | ')})` : '';
  lines.push(`• QC ค้างสะสม: ${c.qcBacklogTotal} งาน${backlogSuffix}`);

  return lines;
}

/**
 * Formats the DailySummaryReport into a crisp, 30-second scannable Thai plain-text + emoji LINE message.
 */
export function formatDailySummaryText(report: DailySummaryReport): string {
  const thaiDate = formatThaiShortDate(report.reportDate, true);
  const constructionScopeLabel = report.projectFilter
    ? `โครงการ: ${report.projectFilter}`
    : report.projectsConstruction.length === 1
      ? `โครงการ: ${report.projectsConstruction[0].projectName}`
      : `ภาพรวมก่อสร้าง (${report.projectsConstruction.length} โครงการ)`;

  const lines: string[] = [
    `📊 สรุปรายวัน BuildTrack | ${thaiDate} (19:00 น.)`,
    '',
  ];

  // 1. Construction & QC (Projects from ไอลิน 6 onwards)
  const constructionHeader = report.projectFilter
    ? `🏗️ ฝั่งก่อสร้าง (${report.projectFilter})`
    : report.projectsConstruction.length === 1
      ? `🏗️ ฝั่งก่อสร้าง (${report.projectsConstruction[0].projectName})`
      : `🏗️ ฝั่งก่อสร้าง (${constructionScopeLabel})`;

  lines.push(...formatConstructionBlock(report.overallConstruction, constructionHeader));

  // Per-project compact breakdown when tracking multiple active construction projects (e.g., ไอลิน6 + ไอลิน7)
  if (!report.projectFilter && report.projectsConstruction.length > 1) {
    lines.push('📌 แยกรายโครงการ:');
    for (const proj of report.projectsConstruction) {
      const qcNote = proj.qcBacklogTotal > 0 ? ` | QC ค้าง ${proj.qcBacklogTotal}` : '';
      const delayNote = proj.delayedPlots > 0 ? ` | ล่าช้า ${proj.delayedPlots}` : '';
      lines.push(
        `  - ${proj.projectName}: ${fmtPct(proj.actualProgressPct)} (แผน ${fmtPct(proj.plannedProgressPct)}, วันนี้ ${fmtSignedPct(proj.todayDeltaPct)})${qcNote}${delayNote}`,
      );
    }
  }

  // Urgent Construction/Operational Alerts (Alert-only)
  const constructionAlerts = report.urgentAlerts.filter((a) => a.category !== 'customer_voice');
  if (constructionAlerts.length > 0) {
    lines.push('');
    for (const alert of constructionAlerts.slice(0, 5)) {
      lines.push(`⚠️ ${alert.message}`);
    }
  }

  // 2. Sales & CRM (All open projects with remaining unsold/pending-transfer units, excluding external sites)
  const s = report.sales;
  const showSalesProjectPrefix = !report.projectFilter && s.includedProjects.length > 1;
  const salesHeader = report.projectFilter
    ? `💼 ฝั่งขาย (${report.projectFilter})`
    : s.includedProjects.length > 1
      ? `💼 ฝั่งขาย (รวม ${s.includedProjects.length} โครงการที่ยังเปิดขาย)`
      : s.includedProjects.length === 1
        ? `💼 ฝั่งขาย (${s.includedProjects[0].projectName})`
        : '💼 ฝั่งขาย';

  lines.push('');
  lines.push(salesHeader);

  const todayFunnelParts = [
    `Lead ใหม่ ${s.leadsToday}`,
    `เข้าชม ${s.visitsToday}`,
    `จอง ${s.bookingsToday}`,
  ];
  if (s.loanApprovedToday > 0) {
    todayFunnelParts.push(`สินเชื่อผ่าน ${s.loanApprovedToday}`);
  }
  if (s.cancellationsToday > 0) {
    todayFunnelParts.push(`ยกเลิก ${s.cancellationsToday}`);
  }
  lines.push(`• วันนี้: ${todayFunnelParts.join(' | ')}`);

  lines.push(
    `• สะสมเดือนนี้: Lead ${s.leadsMtd} | จอง ${s.bookingsMtd} แปลง | โอน ${s.transfersMtd} แปลง`,
  );

  if (s.includedProjects.length > 0 && s.totalRemainingPlots > 0) {
    const breakdown = s.includedProjects
      .filter((p) => p.remainingPlots > 0)
      .map((p) => `${p.projectName}: ${p.remainingPlots}`)
      .join(' | ');
    const breakdownSuffix = breakdown ? ` (${breakdown})` : '';
    lines.push(`• คงเหลือยังไม่โอน: ${s.totalRemainingPlots} แปลง${breakdownSuffix}`);
  }

  // Alert-only: SLA breach / uncontacted leads > 24h
  if (s.slaBreachCount > 0) {
    lines.push(`• ⏰ ค้างติดตาม (ยังไม่ติดต่อ >24 ชม.): ${s.slaBreachCount} ราย`);
  }

  // Alert-only: Today's transfers or expected transfers today
  if (s.transfersToday.length > 0) {
    lines.push('🏠 โอน / คาดการณ์โอนวันนี้:');
    for (const item of s.transfersToday.slice(0, 6)) {
      const projPrefix = showSalesProjectPrefix ? `[${item.projectName}] ` : '';
      const custPart = item.customerName ? ` (${item.customerName})` : '';
      lines.push(`  - ${projPrefix}แปลง ${item.plotLabel}${custPart}: ${formatTransferReadiness(item)}`);
    }
  }

  // Alert-only: Upcoming transfers in next 7 days
  if (s.upcomingTransfers7Days.length > 0) {
    lines.push(`📅 คาดการณ์โอนใน 7 วัน (${s.upcomingTransfers7Days.length} แปลง):`);
    for (const item of s.upcomingTransfers7Days.slice(0, 6)) {
      const projPrefix = showSalesProjectPrefix ? `[${item.projectName}] ` : '';
      const dateShort = item.expectedTransferDate ? formatThaiShortDate(item.expectedTransferDate, false) : '-';
      lines.push(
        `  - ${projPrefix}แปลง ${item.plotLabel} (${dateShort}): ${formatTransferReadiness(item)}`,
      );
    }
  }

  // Alert-only: Customer Voices alerts
  const voiceAlerts = report.urgentAlerts.filter((a) => a.category === 'customer_voice');
  if (voiceAlerts.length > 0) {
    for (const alert of voiceAlerts.slice(0, 3)) {
      lines.push(`📣 ${alert.message}`);
    }
  }

  // Optional dashboard link
  if (report.appUrl) {
    const cleanUrl = report.appUrl.replace(/\/+$/, '');
    lines.push('');
    lines.push(`🔗 ดูรายละเอียดเพิ่มเติม: ${cleanUrl}`);
  }

  return lines.join('\n');
}

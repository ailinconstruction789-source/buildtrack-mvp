export interface ProjectConstructionMetrics {
  projectName: string;
  totalPlots: number;
  activePlots: number;
  completedPlots: number;
  actualProgressPct: number;
  plannedProgressPct: number;
  variancePct: number;
  todayDeltaPct: number;
  delayedPlots: number;
  plotsWithWorkersToday: number;
  plotsWithoutWorkersToday: number;
  plotsUpdatedToday: number;
  qcEnteredToday: number;
  qcInspectedToday: number;
  qcPassedToday: number;
  qcRejectedToday: number;
  qcBacklogTotal: number;
  qcBacklogOverdue3Days: number;
  sePendingCount: number;
  reworkPendingCount: number;
  pePendingCount: number;
}

export interface TransferScheduleItem {
  plotId: string;
  plotLabel: string;
  projectName: string;
  customerName: string | null;
  expectedTransferDate: string | null;
  actualTransferDate: string | null;
  isTransferredToday: boolean;
  isExpectedToday: boolean;
  daysUntilTransfer: number | null;
  houseProgressPct: number;
  openDefectsCount: number;
  isHouseReady: boolean;
  bankStatus: string | null;
}

export interface UrgentAlertItem {
  severity: 'high' | 'medium';
  category: 'defect_transfer' | 'material_request' | 'qc_leave' | 'customer_voice';
  message: string;
}

export interface SalesProjectStockSummary {
  projectName: string;
  totalPlots: number;
  transferredPlots: number;
  remainingPlots: number;
}

export interface SalesSummaryMetrics {
  includedProjects: SalesProjectStockSummary[];
  totalRemainingPlots: number;
  leadsToday: number;
  visitsToday: number;
  bookingsToday: number;
  cancellationsToday: number;
  loanApprovedToday: number;
  bookingsMtd: number;
  transfersMtd: number;
  leadsMtd: number;
  slaBreachCount: number;
  transfersToday: TransferScheduleItem[];
  upcomingTransfers7Days: TransferScheduleItem[];
  customerVoicesToday: number;
  lowScoreVoicesToday: number;
}

export interface DailySummaryReport {
  reportDate: string; // YYYY-MM-DD in Asia/Bangkok
  generatedAt: string; // ISO timestamp
  projectFilter: string | null;
  overallConstruction: ProjectConstructionMetrics;
  projectsConstruction: ProjectConstructionMetrics[];
  sales: SalesSummaryMetrics;
  urgentAlerts: UrgentAlertItem[];
  appUrl: string | null;
}

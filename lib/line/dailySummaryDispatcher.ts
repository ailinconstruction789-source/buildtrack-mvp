import type { SupabaseClient } from '@supabase/supabase-js';
import {
  collectDailySummaryReport,
  createLineSummarySupabaseClient,
} from './dailySummaryData';
import { formatDailySummaryText } from './dailySummaryFormatter';
import { pushLineTextMessage } from './lineMessagingClient';
import type { DailySummaryReport } from './dailySummaryTypes';

export interface DispatchDailySummaryParams {
  reportDate?: string;
  projectFilter?: string | null;
  dryRun?: boolean;
  force?: boolean;
  triggerSource?: 'cron' | 'manual' | 'webhook';
  supabase?: SupabaseClient;
  channelAccessToken?: string;
  targetId?: string;
  fetchImpl?: typeof fetch;
}

export interface DispatchDailySummaryResult {
  ok: boolean;
  status: 'sent' | 'dry_run' | 'skipped_duplicate' | 'failed';
  reportDate: string;
  message: string;
  report: DailySummaryReport;
  lineStatus?: number;
  error?: string;
}

async function hasAlreadySentToday(
  supabase: SupabaseClient,
  reportDate: string,
  targetId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('line_daily_summary_logs')
    .select('id')
    .eq('report_date', reportDate)
    .eq('target_id', targetId)
    .eq('status', 'sent')
    .limit(1);

  if (error) {
    // Table may not be migrated yet — do not block sending
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

async function recordDispatchLog(
  supabase: SupabaseClient,
  entry: {
    report_date: string;
    target_id: string;
    trigger_source: 'cron' | 'manual' | 'webhook';
    status: 'sent' | 'failed' | 'dry_run';
    message_text: string;
    metrics_snapshot: DailySummaryReport;
    error_message?: string | null;
  },
): Promise<void> {
  try {
    await supabase.from('line_daily_summary_logs').insert([entry]);
  } catch {
    // Gracefully ignore if log table hasn't been created yet
  }
}

/**
 * Generates the daily executive summary and (unless dryRun) pushes it to the central LINE group.
 */
export async function dispatchLineDailySummary(
  params: DispatchDailySummaryParams = {},
): Promise<DispatchDailySummaryResult> {
  const supabase = params.supabase ?? createLineSummarySupabaseClient();
  const triggerSource = params.triggerSource ?? 'cron';
  const dryRun = Boolean(params.dryRun);
  const force = Boolean(params.force);

  const report = await collectDailySummaryReport(supabase, {
    reportDate: params.reportDate,
    projectFilter: params.projectFilter ?? null,
  });
  const message = formatDailySummaryText(report);

  const targetId = (params.targetId ?? process.env.LINE_GROUP_ID ?? '').trim();
  const channelAccessToken = (
    params.channelAccessToken ??
    process.env.LINE_CHANNEL_ACCESS_TOKEN ??
    ''
  ).trim();

  if (dryRun) {
    return {
      ok: true,
      status: 'dry_run',
      reportDate: report.reportDate,
      message,
      report,
    };
  }

  if (!channelAccessToken) {
    return {
      ok: false,
      status: 'failed',
      reportDate: report.reportDate,
      message,
      report,
      error: 'Missing LINE_CHANNEL_ACCESS_TOKEN environment variable',
    };
  }

  if (!targetId) {
    return {
      ok: false,
      status: 'failed',
      reportDate: report.reportDate,
      message,
      report,
      error: 'Missing LINE_GROUP_ID environment variable',
    };
  }

  if (!force && triggerSource === 'cron') {
    const alreadySent = await hasAlreadySentToday(supabase, report.reportDate, targetId);
    if (alreadySent) {
      return {
        ok: true,
        status: 'skipped_duplicate',
        reportDate: report.reportDate,
        message,
        report,
      };
    }
  }

  const sendResult = await pushLineTextMessage({
    channelAccessToken,
    to: targetId,
    text: message,
    fetchImpl: params.fetchImpl,
  });

  await recordDispatchLog(supabase, {
    report_date: report.reportDate,
    target_id: targetId,
    trigger_source: triggerSource,
    status: sendResult.ok ? 'sent' : 'failed',
    message_text: message,
    metrics_snapshot: report,
    error_message: sendResult.error ?? null,
  });

  if (!sendResult.ok) {
    return {
      ok: false,
      status: 'failed',
      reportDate: report.reportDate,
      message,
      report,
      lineStatus: sendResult.status,
      error: sendResult.error,
    };
  }

  return {
    ok: true,
    status: 'sent',
    reportDate: report.reportDate,
    message,
    report,
    lineStatus: sendResult.status,
  };
}

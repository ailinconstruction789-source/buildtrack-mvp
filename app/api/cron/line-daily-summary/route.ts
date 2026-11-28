import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { dispatchLineDailySummary } from '@/lib/line/dailySummaryDispatcher';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function timingSafeSecretEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isAuthorizedCronRequest(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    // Fail closed in production if CRON_SECRET is not configured
    return process.env.NODE_ENV !== 'production';
  }

  const authHeader = request.headers.get('authorization') || '';
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
  const bearerToken = bearerMatch?.[1]?.trim() || '';
  if (bearerToken && timingSafeSecretEqual(bearerToken, cronSecret)) {
    return true;
  }

  const headerSecret = request.headers.get('x-cron-secret')?.trim() || '';
  if (headerSecret && timingSafeSecretEqual(headerSecret, cronSecret)) {
    return true;
  }

  return false;
}

async function handleCronRequest(request: Request, triggerSource: 'cron' | 'manual') {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized: invalid or missing CRON_SECRET' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const url = new URL(request.url);
    const dryRun = url.searchParams.get('dryRun') === 'true';
    const force = url.searchParams.get('force') === 'true';
    const dateParam = url.searchParams.get('date') || undefined;
    const projectFilter = url.searchParams.get('project') || null;

    if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid date parameter. Expected YYYY-MM-DD.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const result = await dispatchLineDailySummary({
      reportDate: dateParam,
      projectFilter,
      dryRun,
      force,
      triggerSource,
    });

    const httpStatus = result.ok ? 200 : 500;
    return NextResponse.json(result, {
      status: httpStatus,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

/**
 * Vercel Cron triggers GET /api/cron/line-daily-summary daily at 12:00 UTC (19:00 Asia/Bangkok).
 */
export async function GET(request: Request) {
  return handleCronRequest(request, 'cron');
}

/**
 * Allows manual/admin triggers via POST with Authorization: Bearer <CRON_SECRET>.
 */
export async function POST(request: Request) {
  return handleCronRequest(request, 'manual');
}

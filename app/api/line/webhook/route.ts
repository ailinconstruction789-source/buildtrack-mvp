import { NextResponse } from 'next/server';
import {
  collectDailySummaryReport,
  createLineSummarySupabaseClient,
} from '@/lib/line/dailySummaryData';
import { formatDailySummaryText } from '@/lib/line/dailySummaryFormatter';
import {
  replyLineTextMessage,
  verifyLineSignature,
} from '@/lib/line/lineMessagingClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface LineWebhookEvent {
  type?: string;
  replyToken?: string;
  source?: {
    type?: 'user' | 'group' | 'room';
    groupId?: string;
    roomId?: string;
    userId?: string;
  };
  message?: {
    type?: string;
    text?: string;
  };
}

const GROUP_ID_COMMANDS = new Set(['/groupid', 'groupid', 'ดู group id', 'ขอ group id']);
const SUMMARY_COMMANDS = new Set(['/summary', 'สรุปวันนี้', 'สรุปรายวัน', 'สรุปงานวันนี้']);

export async function POST(request: Request) {
  const channelSecret = process.env.LINE_CHANNEL_SECRET?.trim() || '';
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim() || '';

  if (!channelSecret) {
    return NextResponse.json(
      { ok: false, error: 'LINE_CHANNEL_SECRET is not configured' },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  const signature = request.headers.get('x-line-signature');

  if (!verifyLineSignature(rawBody, signature, channelSecret)) {
    return NextResponse.json({ ok: false, error: 'Invalid LINE signature' }, { status: 401 });
  }

  let payload: { events?: LineWebhookEvent[] };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const events = Array.isArray(payload.events) ? payload.events : [];
  if (events.length === 0 || !channelAccessToken) {
    // LINE Webhook Verification sends an empty events array and expects HTTP 200
    return NextResponse.json({ ok: true, handled: 0 });
  }

  const configuredGroupId = process.env.LINE_GROUP_ID?.trim() || '';
  let handled = 0;

  for (const event of events) {
    if (event.type !== 'message' || event.message?.type !== 'text' || !event.replyToken) {
      continue;
    }

    const text = (event.message.text || '').trim();
    const normalized = text.toLowerCase();
    const sourceId =
      event.source?.groupId || event.source?.roomId || event.source?.userId || '';

    // 1. Helper command to discover LINE Group ID during setup
    if (GROUP_ID_COMMANDS.has(normalized)) {
      const sourceLabel =
        event.source?.type === 'group'
          ? `LINE Group ID:\n${event.source.groupId}`
          : event.source?.type === 'room'
            ? `LINE Room ID:\n${event.source.roomId}`
            : `LINE User ID:\n${event.source?.userId || 'ไม่พบ ID'}`;

      await replyLineTextMessage({
        channelAccessToken,
        replyToken: event.replyToken,
        text: `🔑 ${sourceLabel}\n\nนำค่านี้ไปใส่ในตัวแปร LINE_GROUP_ID บน Vercel ได้เลยครับ`,
      });
      handled++;
      continue;
    }

    // 2. On-demand summary command (free via replyToken; restricted to configured LINE_GROUP_ID)
    if (SUMMARY_COMMANDS.has(normalized)) {
      if (!configuredGroupId || sourceId !== configuredGroupId) {
        await replyLineTextMessage({
          channelAccessToken,
          replyToken: event.replyToken,
          text: '🔒 คำสั่งนี้ใช้งานได้เฉพาะในกลุ่มกลางที่ตั้งค่าไว้ใน LINE_GROUP_ID เท่านั้นครับ',
        });
        handled++;
        continue;
      }

      try {
        const supabase = createLineSummarySupabaseClient();
        const report = await collectDailySummaryReport(supabase);
        const summaryText = formatDailySummaryText(report);

        await replyLineTextMessage({
          channelAccessToken,
          replyToken: event.replyToken,
          text: summaryText,
        });
        handled++;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'ไม่สามารถดึงข้อมูลสรุปได้';
        await replyLineTextMessage({
          channelAccessToken,
          replyToken: event.replyToken,
          text: `⚠️ เกิดข้อผิดพลาดในการดึงข้อมูลสรุป: ${errMsg}`,
        });
        handled++;
      }
    }
  }

  return NextResponse.json({ ok: true, handled });
}

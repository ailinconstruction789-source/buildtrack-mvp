import crypto from 'node:crypto';

const LINE_PUSH_API_URL = 'https://api.line.me/v2/bot/message/push';
const LINE_REPLY_API_URL = 'https://api.line.me/v2/bot/message/reply';
const LINE_MAX_TEXT_LENGTH = 4900; // LINE limit is 5000 chars per text message
const LINE_MAX_MESSAGES_PER_CALL = 5;

export interface LineSendResult {
  ok: boolean;
  status: number;
  messageCount: number;
  error?: string;
}

/**
 * Splits a long text message cleanly at line boundaries to respect LINE's 5,000-char limit.
 */
export function splitLineTextMessages(text: string, maxLength = LINE_MAX_TEXT_LENGTH): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxLength) return [trimmed];

  const lines = trimmed.split('\n');
  const chunks: string[] = [];
  let current = '';

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = '';
    }

    if (line.length <= maxLength) {
      current = line;
    } else {
      // Fallback hard split for unusually long single line
      for (let i = 0; i < line.length; i += maxLength) {
        chunks.push(line.slice(i, i + maxLength));
      }
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.slice(0, LINE_MAX_MESSAGES_PER_CALL);
}

/**
 * Verifies LINE webhook HMAC-SHA256 signature (`x-line-signature`).
 */
export function verifyLineSignature(
  rawBody: string,
  signature: string | null,
  channelSecret: string,
): boolean {
  if (!signature || !channelSecret) return false;
  const expected = crypto
    .createHmac('sha256', channelSecret)
    .update(rawBody, 'utf8')
    .digest('base64');

  const sigBuf = Buffer.from(signature, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

/**
 * Sends a push message to a LINE Group ID, Room ID, or User ID via Messaging API.
 */
export async function pushLineTextMessage(params: {
  channelAccessToken: string;
  to: string;
  text: string;
  fetchImpl?: typeof fetch;
}): Promise<LineSendResult> {
  const { channelAccessToken, to, text, fetchImpl = fetch } = params;
  const chunks = splitLineTextMessages(text);
  if (chunks.length === 0) {
    return { ok: false, status: 400, messageCount: 0, error: 'Empty message text' };
  }

  const response = await fetchImpl(LINE_PUSH_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({
      to,
      messages: chunks.map((chunk) => ({ type: 'text', text: chunk })),
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    return {
      ok: false,
      status: response.status,
      messageCount: chunks.length,
      error: errorBody || `LINE API returned HTTP ${response.status}`,
    };
  }

  return { ok: true, status: response.status, messageCount: chunks.length };
}

/**
 * Sends a free reply message via LINE replyToken (used by webhook commands).
 */
export async function replyLineTextMessage(params: {
  channelAccessToken: string;
  replyToken: string;
  text: string;
  fetchImpl?: typeof fetch;
}): Promise<LineSendResult> {
  const { channelAccessToken, replyToken, text, fetchImpl = fetch } = params;
  const chunks = splitLineTextMessages(text);
  if (chunks.length === 0) {
    return { ok: false, status: 400, messageCount: 0, error: 'Empty message text' };
  }

  const response = await fetchImpl(LINE_REPLY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: chunks.map((chunk) => ({ type: 'text', text: chunk })),
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    return {
      ok: false,
      status: response.status,
      messageCount: chunks.length,
      error: errorBody || `LINE Reply API returned HTTP ${response.status}`,
    };
  }

  return { ok: true, status: response.status, messageCount: chunks.length };
}

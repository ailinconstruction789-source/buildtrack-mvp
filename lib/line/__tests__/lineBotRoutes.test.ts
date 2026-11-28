import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as webhookPost } from '@/app/api/line/webhook/route';

function signBody(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64');
}

describe('LINE webhook route', () => {
  const originalEnv = {
    LINE_CHANNEL_SECRET: process.env.LINE_CHANNEL_SECRET,
    LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    LINE_GROUP_ID: process.env.LINE_GROUP_ID,
  };

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('rejects requests with invalid x-line-signature', async () => {
    process.env.LINE_CHANNEL_SECRET = 'secret_test';
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'token_test';

    const body = JSON.stringify({ events: [] });
    const req = new Request('https://example.com/api/line/webhook', {
      method: 'POST',
      headers: { 'x-line-signature': 'bad_sig' },
      body,
    });

    const res = await webhookPost(req);
    expect(res.status).toBe(401);
  });

  it('returns 200 on LINE webhook verification (empty events)', async () => {
    process.env.LINE_CHANNEL_SECRET = 'secret_test';
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'token_test';

    const body = JSON.stringify({ events: [] });
    const req = new Request('https://example.com/api/line/webhook', {
      method: 'POST',
      headers: { 'x-line-signature': signBody(body, 'secret_test') },
      body,
    });

    const res = await webhookPost(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, handled: 0 });
  });

  it('replies with LINE Group ID when /groupid is sent in a group', async () => {
    process.env.LINE_CHANNEL_SECRET = 'secret_test';
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'token_test';

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));

    const body = JSON.stringify({
      events: [
        {
          type: 'message',
          replyToken: 'reply_tok_1',
          source: { type: 'group', groupId: 'C1234567890abcdef' },
          message: { type: 'text', text: '/groupid' },
        },
      ],
    });

    const req = new Request('https://example.com/api/line/webhook', {
      method: 'POST',
      headers: { 'x-line-signature': signBody(body, 'secret_test') },
      body,
    });

    const res = await webhookPost(req);
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    const sent = JSON.parse(String(init?.body));
    expect(sent.replyToken).toBe('reply_tok_1');
    expect(sent.messages[0].text).toContain('C1234567890abcdef');
  });

  it('blocks สรุปวันนี้ when sent outside the configured LINE_GROUP_ID', async () => {
    process.env.LINE_CHANNEL_SECRET = 'secret_test';
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'token_test';
    process.env.LINE_GROUP_ID = 'C_ALLOWED_GROUP';

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));

    const body = JSON.stringify({
      events: [
        {
          type: 'message',
          replyToken: 'reply_tok_2',
          source: { type: 'group', groupId: 'C_OTHER_GROUP' },
          message: { type: 'text', text: 'สรุปวันนี้' },
        },
      ],
    });

    const req = new Request('https://example.com/api/line/webhook', {
      method: 'POST',
      headers: { 'x-line-signature': signBody(body, 'secret_test') },
      body,
    });

    const res = await webhookPost(req);
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    const sent = JSON.parse(String(init?.body));
    expect(sent.messages[0].text).toContain('เฉพาะในกลุ่มกลาง');
  });
});

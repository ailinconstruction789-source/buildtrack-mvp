import { test, expect, type BrowserContext, type Page, type Request as BrowserRequest } from '@playwright/test';
import { createHash } from 'node:crypto';
import QRCode from 'qrcode';
import { appOrigin, fixtureOrigin, scopeQuery, sessionFor } from '../scripts/sales-ui-test/fixture.mjs';
import { VOICE_SCORES } from '../lib/sales/customerVoicesTemplate';
import { matchesQrPixels } from '../scripts/sales-ui-test/qr-pixels.mjs';

// Runs the real Next pages, client, API handlers and Supabase SDK against a fake HTTP backend.
// Database/role enforcement is NOT established by this substitute (see native SQL tests).
interface FixtureState {
  syntheticOnly: true; submissions: number; visitStatus: string;
  submission: { answers: Record<string, unknown> } | null;
  requests: { rpc: string; actor: string | null; body: Record<string, unknown> }[];
}
async function state(request: Page['request']): Promise<FixtureState> {
  const response = await request.get(`${fixtureOrigin}/__fixture/state`, { headers: { 'x-voice-fixture': 'synthetic-only' } });
  expect(response.ok()).toBe(true); const result = await response.json(); expect(result.syntheticOnly).toBe(true); return result;
}
async function fence(context: BrowserContext) {
  await context.route('**/*', route => {
    const origin = new URL(route.request().url()).origin;
    if (![appOrigin, fixtureOrigin].includes(origin)) throw new Error(`Test refuses non-fixture origin: ${origin}`);
    return route.continue();
  });
}
async function staff(page: Page, kind = 'sales') {
  await page.context().addInitScript(session => {
    if (window.location.pathname.startsWith('/sales-crm/')) localStorage.setItem('sb-127-auth-token', JSON.stringify(session));
  }, sessionFor(kind));
  await page.goto(`/sales-crm/customer-voices?${scopeQuery}`);
  await expect(page.getByRole('heading', { name: 'ลูกค้าสมมติสำหรับทดสอบ' })).toBeVisible();
}
async function issue(page: Page): Promise<string> {
  await page.getByLabel('เหตุผลในการออก / ยกเลิก QR *', { exact: true }).fill('ทดสอบด้วยข้อมูลสมมติเท่านั้น');
  await page.getByRole('button', { name: /^ออก QR/ }).click();
  const qr = page.getByRole('img', { name: 'QR แบบประเมิน Customer Voices' });
  await expect(qr).toBeVisible(); await expect(qr).toHaveAttribute('src', /^data:image\/png;base64,/);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: appOrigin });
  await page.getByRole('button', { name: 'คัดลอกลิงก์ให้ลูกค้า' }).click();
  await expect(page.getByRole('status')).toContainText('คัดลอกลิงก์แล้ว');
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/^http:\/\/127\.0\.0\.1:3146\/customer-voices#token=[a-f0-9]{64}$/);
  expect(matchesQrPixels(await qr.getAttribute('src'), await QRCode.toDataURL(link, { width: 320, margin: 4, errorCorrectionLevel: 'M' }))).toBe(true);
  expect(await qr.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(320);
  return link;
}
async function rate(page: Page) { for (const [, label] of VOICE_SCORES) await page.getByLabel(`${label} *`, { exact: true }).selectOption('4'); }
async function assertNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
test.beforeEach(async ({ request, context, baseURL }) => {
  // Refuse to run against any existing/live application even if config is overridden.
  expect(baseURL).toBe(appOrigin);
  const reset = await request.post(`${fixtureOrigin}/__fixture/reset`, { headers: { 'x-voice-fixture': 'synthetic-only' } });
  expect(await reset.json()).toEqual({ syntheticOnly: true }); await fence(context);
});

test('staff QR → blank customer form → one submission → staff sees completed Visit', async ({ page, browser }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await staff(page); const link = await issue(page); const secret = new URL(link).hash.slice('#token='.length);
  await assertNoOverflow(page);
  await page.screenshot({ path: info.outputPath('staff-qr.png'), fullPage: true });
  const before = await state(page.request);
  expect(before.visitStatus).toBe('awaiting_voice'); expect(before.submissions).toBe(0);
  const command = before.requests.find(r => r.rpc === 'crm_v2_customer_voices_command')!;
  expect(JSON.stringify(command.body)).not.toContain(secret);
  expect(command.body.p_payload).toMatchObject({ tokenHash: createHash('sha256').update(secret).digest('hex') });
  const customer = await browser.newContext({ viewport: page.viewportSize(), serviceWorkers: 'block' });
  try {
    await fence(customer); const form = await customer.newPage(); form.on('pageerror', error => errors.push(error.message));
    const requests: BrowserRequest[] = [];
    form.on('request', req => requests.push(req));
    await customer.addCookies([{ name: 'synthetic_staff_cookie', value: 'must-not-travel-to-api', url: appOrigin }]);
    const response = await form.goto(link);
    // Prove the browser really has a cookie before asserting the API omits it.
    expect((await response!.request().allHeaders()).cookie).toContain('synthetic_staff_cookie=must-not-travel-to-api');
    expect(response!.headers()['referrer-policy']).toBe('no-referrer');
    expect(response!.headers()['x-robots-tag']).toContain('noindex');
    expect(response!.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response!.headers()['x-frame-options']).toBe('DENY');
    // Production-mode local snapshot; Vercel/CDN headers still need a separate staging check.
    expect(response!.headers()['cache-control']).toContain('no-store');
    await expect(form.getByRole('form', { name: 'แบบประเมิน Customer Voices' })).toBeVisible();
    await expect(form).toHaveURL(`${appOrigin}/customer-voices`);
    for (const [, label] of VOICE_SCORES) await expect(form.getByLabel(`${label} *`, { exact: true })).toHaveValue('');
    await expect(form.getByLabel('รายได้ต่อเดือน', { exact: true })).toHaveValue('');
    await expect(form.getByText('ลูกค้าสมมติสำหรับทดสอบ')).toHaveCount(0);
    await form.getByRole('button', { name: 'ส่งแบบประเมิน', exact: true }).click();
    await expect(form.getByRole('main').getByRole('alert')).toContainText('ครบทั้ง 8 ข้อ');
    expect((await state(page.request)).submissions).toBe(0);
    await rate(form); await assertNoOverflow(form);
    await form.screenshot({ path: info.outputPath('customer-form.png'), fullPage: true });
    const submitted = form.waitForResponse(r => r.url().endsWith('/api/customer-voices') && r.status() === 201);
    await form.getByRole('button', { name: 'ส่งแบบประเมิน', exact: true }).click();
    const receipt = await submitted;
    expect(receipt.headers()['cache-control']).toBe('no-store');
    expect(await receipt.json()).toEqual({ data: { submitted: true, replayed: false } });
    await expect(form.getByRole('heading', { name: 'ขอบคุณ ส่งแบบประเมินแล้ว' })).toBeVisible();
    expect(await form.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }))).toEqual({ local: {}, session: {} });
    for (const req of requests) {
      expect(req.url()).not.toContain(secret);
      if (req.url().endsWith('/api/customer-voices')) {
        // headers() omits security-related headers and would give false confidence here.
        const headers = await req.allHeaders();
        expect(headers.authorization).toBeUndefined(); expect(headers.cookie).toBeUndefined(); expect(headers.referer).toBeUndefined();
      }
    }
    const saved = await state(page.request); expect(saved.submissions).toBe(1); expect(saved.visitStatus).toBe('completed');
    expect(Object.keys(saved.submission!.answers).sort()).toEqual(VOICE_SCORES.map(([key]) => key).sort());
    await page.getByRole('button', { name: 'ตรวจสถานะล่าสุด' }).click();
    await expect(page.getByRole('heading', { name: 'ส่ง Customer Voices แล้ว' })).toBeVisible();
    await expect(page.getByText('คะแนนเฉลี่ย 4.00 / 5')).toBeVisible();
    await expect(page.getByRole('img', { name: 'QR แบบประเมิน Customer Voices' })).toHaveCount(0);
    await form.reload(); await expect(form.getByRole('main').getByRole('alert')).toContainText('ลิงก์แบบประเมินไม่ถูกต้อง');
    expect(errors).toEqual([]);
  } finally { await customer.close(); }
});

test('new QR invalidates previous QR; expired QR cannot open the form', async ({ page, context }) => {
  await staff(page); const old = await issue(page); const fresh = await issue(page); expect(fresh).not.toBe(old);
  const form = await context.newPage(); await form.goto(old);
  await expect(form.getByRole('main').getByRole('alert')).toContainText('เปิดแบบประเมินไม่ได้');
  await expect(form.getByRole('form', { name: 'แบบประเมิน Customer Voices' })).toHaveCount(0);
  await form.close();
  await page.request.post(`${fixtureOrigin}/__fixture/expire`, { headers: { 'x-voice-fixture': 'synthetic-only' } });
  // A fresh page tests expiration; changing a fragment in the same page is a separate safety case.
  const expiredForm = await context.newPage();
  await expiredForm.goto(fresh); await expect(expiredForm.getByRole('main').getByRole('alert')).toContainText('เปิดแบบประเมินไม่ได้');
  await expect(expiredForm.getByRole('form', { name: 'แบบประเมิน Customer Voices' })).toHaveCount(0);
  expect((await state(page.request)).submissions).toBe(0);
});

test('lost success response freezes answers; manual retry sends exactly the same request', async ({ page, context }) => {
  await staff(page); const link = await issue(page); const form = await context.newPage(); let lost = false;
  await form.route('**/api/customer-voices', async route => {
    const input = route.request().postDataJSON();
    if (input.command === 'submit' && !lost) { lost = true; await route.fetch(); return route.abort('failed'); }
    return route.continue();
  });
  await form.goto(link); await rate(form);
  await form.getByRole('button', { name: 'ส่งแบบประเมิน', exact: true }).click();
  await expect(form.getByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' })).toBeVisible();
  await expect(form.getByLabel(`${VOICE_SCORES[0][1]} *`, { exact: true })).toBeDisabled();
  expect((await state(page.request)).submissions).toBe(1);
  await form.getByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' }).click();
  await expect(form.getByRole('heading', { name: 'ขอบคุณ ส่งแบบประเมินแล้ว' })).toBeVisible();
  const saved = await state(page.request), attempts = saved.requests.filter(r => r.rpc.endsWith('_submit'));
  expect(saved.submissions).toBe(1); expect(attempts).toHaveLength(2); expect(attempts[0].body).toEqual(attempts[1].body);
});

test('Owner is read-only and unauthenticated staff API cannot issue a QR', async ({ page }) => {
  await staff(page, 'owner'); await expect(page.getByRole('form', { name: 'จัดการ QR Customer Voices' })).toHaveCount(0);
  await expect(page.getByText(/ดูข้อมูลได้อย่างเดียว/)).toBeVisible();
  const read = await page.request.get(`${appOrigin}/api/sales-crm/customer-voices?${scopeQuery}`);
  expect(read.status()).toBe(401); expect((await read.json()).error.code).toBe('UNAUTHENTICATED');
  expect((await state(page.request)).requests.filter(r => r.rpc.endsWith('_command'))).toHaveLength(0);
});

test('invalid links, query tokens and oversized bodies fail without contacting the fake database', async ({ page }) => {
  await page.goto('/customer-voices#token=invalid'); await expect(page.getByRole('main').getByRole('alert')).toContainText('ลิงก์แบบประเมินไม่ถูกต้อง');
  const query = await page.request.post(`${appOrigin}/api/customer-voices?token=not-allowed`, { data: { command: 'open', token: 'a'.repeat(64) } });
  expect(query.status()).toBe(400);
  const oversized = await page.request.post(`${appOrigin}/api/customer-voices`, { data: { command: 'open', token: 'a'.repeat(17000) } });
  expect(oversized.status()).toBe(413);
  const html = await page.request.post(`${appOrigin}/api/customer-voices`, { headers: { 'Content-Type': 'text/plain' }, data: '{}' });
  expect(html.status()).toBe(415);
  const unsupported = await page.request.get(`${appOrigin}/api/customer-voices`); expect(unsupported.status()).toBe(405);
  expect((await state(page.request)).requests).toHaveLength(0);
});

test('changing QR within the same page clears old answers and does not submit them to another Visit', async ({ page, context }) => {
  await staff(page); const old = await issue(page), form = await context.newPage();
  await form.goto(old); await rate(form); await form.getByLabel('ชื่อเล่น', { exact: true }).fill('คำตอบสมมติห้ามข้าม Visit');
  const fresh = await issue(page); await form.evaluate(hash => { window.location.hash = hash; }, new URL(fresh).hash);
  await expect(form.getByRole('main').getByRole('alert')).toContainText('ลิงก์เปลี่ยนในหน้าเดิม');
  await expect(form.getByRole('form', { name: 'แบบประเมิน Customer Voices' })).toHaveCount(0);
  expect((await state(page.request)).submissions).toBe(0);
});

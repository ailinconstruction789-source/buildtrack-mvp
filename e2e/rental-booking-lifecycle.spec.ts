import { test, expect, type Page } from '@playwright/test';

/**
 * Rental Booking, Contract Sync, Conflict & Plot Ownership E2E Spec
 * (Deterministic Staging / Local Test Environment Only — NEVER Production)
 *
 * Design rules:
 * 1. Zero conditional `if (await target.isVisible()) { assert... }` guards.
 *    Every test asserts `await expect(target).toBeVisible()` before interacting
 *    so missing fixtures fail loudly instead of passing vacuously.
 * 2. Requires explicit non-production environment configuration (`E2E_TEST_ENV=staging|local`
 *    and `E2E_ALLOW_TEST_MUTATIONS=true` for mutating flows) plus deterministic seeded fixtures.
 * 3. Production environments are explicitly rejected to protect live customer data.
 *
 * Required environment variables for full Staging/Local execution:
 *   E2E_TEST_ENV=staging|local
 *   E2E_ALLOW_TEST_MUTATIONS=true              (required for sign / cancel / stale-cancel tests)
 *   E2E_PROJECT_NAME=<seeded-test-project>
 *   E2E_SALES_USERNAME=<sales-user>            E2E_SALES_PIN=<pin>
 *   E2E_SALES2_USERNAME=<other-sales-user>     E2E_SALES2_PIN=<pin>
 *   E2E_OWNER_USERNAME=<readonly-owner>        E2E_OWNER_PIN=<pin>
 *
 * Deterministic seeded fixture identifiers (one dedicated fixture per mutating scenario):
 *   E2E_PENDING_CUSTOMER_NAME=<customer>       E2E_PENDING_PLOT_NAME=<plot-label>
 *   E2E_SIGN_CUSTOMER_NAME=<customer>          E2E_SIGN_PLOT_NAME=<plot-label>
 *   E2E_CANCEL_CUSTOMER_NAME=<customer>        E2E_CANCEL_PLOT_NAME=<plot-label>
 *   E2E_STALE_CUSTOMER_NAME=<customer>         E2E_STALE_PLOT_NAME=<plot-label>
 *   E2E_CONFLICT_PLOT_NAME=<plot-label>
 *   E2E_INQUIRY_VACANT_PLOT_NAME=<plot-label>
 *   E2E_RESTRICTED_PLOT_NAME=<plot-label>
 */

const TEST_ENV = (process.env.E2E_TEST_ENV || '').trim().toLowerCase();
const ALLOW_MUTATIONS = process.env.E2E_ALLOW_TEST_MUTATIONS === 'true';
const PROJECT_NAME = (process.env.E2E_PROJECT_NAME || '').trim();

const SALES_USER = (process.env.E2E_SALES_USERNAME || '').trim();
const SALES_PIN = (process.env.E2E_SALES_PIN || '').trim();
const SALES2_USER = (process.env.E2E_SALES2_USERNAME || '').trim();
const SALES2_PIN = (process.env.E2E_SALES2_PIN || '').trim();
const OWNER_USER = (process.env.E2E_OWNER_USERNAME || '').trim();
const OWNER_PIN = (process.env.E2E_OWNER_PIN || '').trim();

const PENDING_CUSTOMER = (process.env.E2E_PENDING_CUSTOMER_NAME || '').trim();
const PENDING_PLOT = (process.env.E2E_PENDING_PLOT_NAME || '').trim();
const SIGN_CUSTOMER = (process.env.E2E_SIGN_CUSTOMER_NAME || '').trim();
const SIGN_PLOT = (process.env.E2E_SIGN_PLOT_NAME || '').trim();
const CANCEL_CUSTOMER = (process.env.E2E_CANCEL_CUSTOMER_NAME || '').trim();
const CANCEL_PLOT = (process.env.E2E_CANCEL_PLOT_NAME || '').trim();
const STALE_CUSTOMER = (process.env.E2E_STALE_CUSTOMER_NAME || '').trim();
const STALE_PLOT = (process.env.E2E_STALE_PLOT_NAME || '').trim();
const CONFLICT_PLOT = (process.env.E2E_CONFLICT_PLOT_NAME || '').trim();
const INQUIRY_VACANT_PLOT = (process.env.E2E_INQUIRY_VACANT_PLOT_NAME || '').trim();
const RESTRICTED_PLOT = (process.env.E2E_RESTRICTED_PLOT_NAME || '').trim();

function assertSafeNonProdEnv(requireMutations: boolean) {
  test.skip(
    TEST_ENV !== 'local' && TEST_ENV !== 'staging',
    'Set E2E_TEST_ENV=local or E2E_TEST_ENV=staging with seeded non-production fixtures to run E2E.'
  );
  if (requireMutations) {
    test.skip(
      !ALLOW_MUTATIONS,
      'Set E2E_ALLOW_TEST_MUTATIONS=true on an isolated local/staging database to execute mutating E2E tests.'
    );
  }
  const baseUrl = (process.env.E2E_BASE_URL || process.env.PLAYWRIGHT_BASE_URL || '').toLowerCase();
  if (baseUrl.includes('prod') || TEST_ENV === 'production') {
    throw new Error('Refusing to run E2E fixtures against a production environment.');
  }
}

function requireVars(vars: Record<string, string>) {
  const missing = Object.entries(vars)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  test.skip(
    missing.length > 0,
    `Missing required staging/local E2E fixture env vars: ${missing.join(', ')}`
  );
}

async function signIn(page: Page, username: string, pin: string) {
  await page.goto('/');
  await expect(page.getByText('BuildTrack').first()).toBeVisible({ timeout: 30000 });
  const select = page.locator('select#username-select');
  await expect(select).toBeEnabled({ timeout: 20000 });
  await select.selectOption(username);
  await page.fill('input#pin-input', pin);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(select).toBeHidden({ timeout: 30000 });
}

async function navigateToMyLead(page: Page) {
  const myLeadBtn = page.getByRole('button', { name: /My Lead|ลูกค้าของฉัน|งานขายของฉัน/i }).first();
  await expect(myLeadBtn).toBeVisible({ timeout: 20000 });
  await myLeadBtn.click();
}

async function navigateToRentalWorkspace(page: Page) {
  const rentalBtn = page.getByRole('button', { name: /บริหารบ้านเช่า|Ailin Rental|จัดการเช่า/i }).first();
  await expect(rentalBtn).toBeVisible({ timeout: 20000 });
  await rentalBtn.click();
  await expect(page.getByText(/Ailin Rental|บริหารบ้านเช่า|บริหารสัญญาเช่า/i).first()).toBeVisible({ timeout: 20000 });
}

async function navigateToProjectMap(page: Page, projectName: string) {
  const salesMenu = page.getByRole('button', { name: /ฝ่ายขาย|Sales|Project Map|แผนผัง/i }).first();
  await expect(salesMenu).toBeVisible({ timeout: 20000 });
  await salesMenu.click();

  const projectEntry = page.getByText(projectName, { exact: false }).first();
  await expect(projectEntry).toBeVisible({ timeout: 20000 });
  await projectEntry.click();

  const mapTab = page.getByRole('button', { name: /แผนผัง|Map/i }).first();
  await expect(mapTab).toBeVisible({ timeout: 20000 });
  await mapTab.click();
}

function locatePlotTile(page: Page, plotLabel: string) {
  return page
    .locator(`[data-plot-name="${plotLabel}"], button:has-text("${plotLabel}"), [role="button"]:has-text("${plotLabel}")`)
    .first();
}

test.describe('Rental Booking, Sync, Conflict & Plot Ownership E2E (Deterministic Staging Fixtures)', () => {
  test('1. Opening PendingContract from My Lead and Project Map shows the same customer and canonical plot', async ({ page }) => {
    assertSafeNonProdEnv(false);
    requireVars({
      E2E_SALES_USERNAME: SALES_USER,
      E2E_SALES_PIN: SALES_PIN,
      E2E_PROJECT_NAME: PROJECT_NAME,
      E2E_PENDING_CUSTOMER_NAME: PENDING_CUSTOMER,
      E2E_PENDING_PLOT_NAME: PENDING_PLOT,
    });

    await signIn(page, SALES_USER, SALES_PIN);

    // 1A. Verify PendingContract in My Lead
    await navigateToMyLead(page);
    const myLeadRow = page.locator('tr, [data-testid="my-lead-card"]').filter({ hasText: PENDING_CUSTOMER }).first();
    await expect(myLeadRow).toBeVisible({ timeout: 20000 });
    await expect(myLeadRow).toContainText(PENDING_PLOT);

    const signBtnMyLead = myLeadRow.getByRole('button', { name: /ทำสัญญาเช่าจริง|ทำสัญญาเช่า/i }).first();
    await expect(signBtnMyLead).toBeVisible({ timeout: 10000 });
    await signBtnMyLead.click();

    // Must open RentalContractModal (not SalesDealStatusModal or RentalActionModal)
    await expect(page.getByText(/บันทึกสัญญาเช่า|ยืนยันบันทึกสัญญาเช่า/i).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(PENDING_CUSTOMER).first()).toBeVisible();
    await expect(page.getByText(/จัดการสัญญาเช่า \(Manage Lease Lifecycle\)/)).toHaveCount(0);
    await expect(page.getByText(/อัปเดตสถานะการขาย/)).toHaveCount(0);

    // Close RentalContractModal
    const closeBtn = page.getByRole('button', { name: /ยกเลิก|ปิด/i }).first();
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();

    // 1B. Verify the SAME PendingContract customer & canonical plot in Project Map
    await navigateToProjectMap(page, PROJECT_NAME);
    const plotTile = locatePlotTile(page, PENDING_PLOT);
    await expect(plotTile).toBeVisible({ timeout: 20000 });
    await plotTile.click();

    const rentalPanel = page.getByTestId('project-map-rental-panel');
    await expect(rentalPanel).toBeVisible({ timeout: 15000 });
    await expect(rentalPanel).toContainText(PENDING_CUSTOMER);
    await expect(rentalPanel).toContainText(PENDING_PLOT);
    await expect(page.getByTestId('project-map-deal-conflict')).toHaveCount(0);

    const signBtnMap = rentalPanel.getByRole('button', { name: /ทำสัญญาเช่าจริง/i });
    await expect(signBtnMap).toBeVisible();
    await signBtnMap.click();

    await expect(page.getByText(/บันทึกสัญญาเช่า|ยืนยันบันทึกสัญญาเช่า/i).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(PENDING_CUSTOMER).first()).toBeVisible();
  });

  test('2. Signing real rental contract syncs Active status across Rental Workspace, My Lead, and Project Map', async ({ page }) => {
    assertSafeNonProdEnv(true);
    requireVars({
      E2E_SALES_USERNAME: SALES_USER,
      E2E_SALES_PIN: SALES_PIN,
      E2E_PROJECT_NAME: PROJECT_NAME,
      E2E_SIGN_CUSTOMER_NAME: SIGN_CUSTOMER,
      E2E_SIGN_PLOT_NAME: SIGN_PLOT,
    });

    await signIn(page, SALES_USER, SALES_PIN);
    await navigateToRentalWorkspace(page);

    const pendingRow = page.locator('tr').filter({ hasText: SIGN_CUSTOMER }).first();
    await expect(pendingRow).toBeVisible({ timeout: 20000 });
    await expect(pendingRow).toContainText(SIGN_PLOT);

    const signContractBtn = pendingRow.getByRole('button', { name: /ทำสัญญาเช่าจริง/i }).first();
    await expect(signContractBtn).toBeVisible({ timeout: 10000 });
    await signContractBtn.click();

    const submitContractBtn = page.getByRole('button', { name: /ยืนยันบันทึกสัญญาเช่า/i });
    await expect(submitContractBtn).toBeEnabled({ timeout: 15000 });
    await submitContractBtn.click();
    await expect(submitContractBtn).toBeHidden({ timeout: 20000 });

    // Confirm Active sync in RentalManagementWorkspace
    const activeRow = page.locator('tr').filter({ hasText: SIGN_CUSTOMER }).first();
    await expect(activeRow).toBeVisible({ timeout: 20000 });
    await expect(activeRow.getByRole('button', { name: /ทำสัญญาเช่าจริง/i })).toHaveCount(0);

    // Confirm Active sync in My Lead
    await navigateToMyLead(page);
    const myLeadActiveRow = page.locator('tr, [data-testid="my-lead-card"]').filter({ hasText: SIGN_CUSTOMER }).first();
    await expect(myLeadActiveRow).toBeVisible({ timeout: 20000 });
    await expect(myLeadActiveRow.getByRole('button', { name: /จัดการสัญญาเช่า/i }).first()).toBeVisible({ timeout: 15000 });

    // Confirm Active sync on Project Map
    await navigateToProjectMap(page, PROJECT_NAME);
    const plotTile = locatePlotTile(page, SIGN_PLOT);
    await expect(plotTile).toBeVisible({ timeout: 20000 });
    await plotTile.click();

    const rentalPanel = page.getByTestId('project-map-rental-panel');
    await expect(rentalPanel).toBeVisible({ timeout: 15000 });
    await expect(rentalPanel).toContainText(SIGN_CUSTOMER);
    await expect(rentalPanel.getByRole('button', { name: /ทำสัญญาเช่าจริง/i })).toHaveCount(0);
    await expect(rentalPanel.getByRole('button', { name: /จัดการสัญญาเช่า/i })).toBeVisible();
  });

  test('3. Cancelling PendingContract with a real reason via shared modal releases the plot back to vacant', async ({ page }) => {
    assertSafeNonProdEnv(true);
    requireVars({
      E2E_SALES_USERNAME: SALES_USER,
      E2E_SALES_PIN: SALES_PIN,
      E2E_PROJECT_NAME: PROJECT_NAME,
      E2E_CANCEL_CUSTOMER_NAME: CANCEL_CUSTOMER,
      E2E_CANCEL_PLOT_NAME: CANCEL_PLOT,
    });

    await signIn(page, SALES_USER, SALES_PIN);
    await navigateToMyLead(page);

    const targetRow = page.locator('tr, [data-testid="my-lead-card"]').filter({ hasText: CANCEL_CUSTOMER }).first();
    await expect(targetRow).toBeVisible({ timeout: 20000 });

    const cancelBtn = targetRow.getByRole('button', { name: /ยกเลิกจองเช่า/i }).first();
    await expect(cancelBtn).toBeVisible({ timeout: 10000 });
    await cancelBtn.click();

    const cancelModal = page.getByTestId('cancel-rental-booking-modal');
    await expect(cancelModal).toBeVisible({ timeout: 10000 });

    const reasonInput = cancelModal.locator('#cancel-rental-reason-input');
    const confirmBtn = cancelModal.getByRole('button', { name: /ยืนยันยกเลิกจองเช่า/i });

    // Empty and whitespace-only reasons MUST keep confirm button disabled
    await expect(confirmBtn).toBeDisabled();
    await reasonInput.fill('     ');
    await expect(confirmBtn).toBeDisabled();

    // Real reason enables confirm and executes atomic cancellation
    await reasonInput.fill('ลูกค้าเปลี่ยนใจไม่สะดวกย้ายเข้าตามกำหนด (Staging E2E)');
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();
    await expect(cancelModal).toBeHidden({ timeout: 20000 });

    // Verify plot returned to vacant on Project Map
    await navigateToProjectMap(page, PROJECT_NAME);
    const releasedPlot = locatePlotTile(page, CANCEL_PLOT);
    await expect(releasedPlot).toBeVisible({ timeout: 20000 });
    await releasedPlot.click();

    await expect(page.getByTestId('project-map-rental-panel')).toHaveCount(0);
    await expect(page.getByTestId('occupied-restricted-panel')).toHaveCount(0);
    await expect(page.getByText(CANCEL_CUSTOMER)).toHaveCount(0);
  });

  test('4. Stale screen cannot cancel a booking that already became Active and instructs user to reload', async ({ browser }) => {
    assertSafeNonProdEnv(true);
    requireVars({
      E2E_SALES_USERNAME: SALES_USER,
      E2E_SALES_PIN: SALES_PIN,
      E2E_STALE_CUSTOMER_NAME: STALE_CUSTOMER,
      E2E_STALE_PLOT_NAME: STALE_PLOT,
    });

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await Promise.all([
        signIn(pageA, SALES_USER, SALES_PIN),
        signIn(pageB, SALES_USER, SALES_PIN),
      ]);

      // Page A opens CancelRentalBookingModal while booking is still PendingContract
      await navigateToMyLead(pageA);
      const staleRowA = pageA.locator('tr, [data-testid="my-lead-card"]').filter({ hasText: STALE_CUSTOMER }).first();
      await expect(staleRowA).toBeVisible({ timeout: 20000 });
      await staleRowA.getByRole('button', { name: /ยกเลิกจองเช่า/i }).first().click();

      const modalA = pageA.getByTestId('cancel-rental-booking-modal');
      await expect(modalA).toBeVisible({ timeout: 10000 });
      await modalA.locator('#cancel-rental-reason-input').fill('ทดสอบหน้าจอ stale หลังอีกฝั่งทำสัญญาจริง');

      // Page B signs the real contract -> transitions booking to Active on server
      await navigateToRentalWorkspace(pageB);
      const pendingRowB = pageB.locator('tr').filter({ hasText: STALE_CUSTOMER }).first();
      await expect(pendingRowB).toBeVisible({ timeout: 20000 });
      await pendingRowB.getByRole('button', { name: /ทำสัญญาเช่าจริง/i }).first().click();

      const submitContractB = pageB.getByRole('button', { name: /ยืนยันบันทึกสัญญาเช่า/i });
      await expect(submitContractB).toBeEnabled({ timeout: 15000 });
      await submitContractB.click();
      await expect(submitContractB).toBeHidden({ timeout: 20000 });

      // Page A attempts to confirm cancellation on the now-Active booking -> MUST be rejected with reload guidance
      const confirmCancelA = modalA.getByRole('button', { name: /ยืนยันยกเลิกจองเช่า/i });
      await expect(confirmCancelA).toBeEnabled();
      await confirmCancelA.click();

      const errorAlertA = modalA.getByTestId('cancel-rental-error');
      await expect(errorAlertA).toBeVisible({ timeout: 15000 });
      await expect(errorAlertA).toContainText(/Active|โหลดข้อมูลใหม่/i);
      await expect(modalA.getByRole('button', { name: /โหลดข้อมูลใหม่และปิด/i })).toBeVisible();
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('5. Read-only Owner cannot perform rental or sales mutations across workspaces', async ({ page }) => {
    assertSafeNonProdEnv(false);
    requireVars({
      E2E_OWNER_USERNAME: OWNER_USER,
      E2E_OWNER_PIN: OWNER_PIN,
      E2E_PROJECT_NAME: PROJECT_NAME,
    });

    await signIn(page, OWNER_USER, OWNER_PIN);

    // Rental Management Workspace: zero mutation controls
    await navigateToRentalWorkspace(page);
    await expect(
      page.getByRole('button', { name: /ทำสัญญาเช่าใหม่|ทำสัญญาเช่าจริง|ยกเลิกจองเช่า|บันทึกสัญญาเช่า|จัดการสัญญาเช่า/ })
    ).toHaveCount(0);

    // Project Map: zero booking/cancellation/status save mutation controls
    await navigateToProjectMap(page, PROJECT_NAME);
    await expect(
      page.getByRole('button', { name: /บันทึกการจอง|ยกเลิกจองเช่า|ทำสัญญาเช่าจริง|บันทึกสถานะ/ })
    ).toHaveCount(0);
  });

  test('6. Conflict record on Project Map renders read-only notice and exposes zero writable sales actions', async ({ page }) => {
    assertSafeNonProdEnv(false);
    requireVars({
      E2E_SALES_USERNAME: SALES_USER,
      E2E_SALES_PIN: SALES_PIN,
      E2E_PROJECT_NAME: PROJECT_NAME,
      E2E_CONFLICT_PLOT_NAME: CONFLICT_PLOT,
    });

    await signIn(page, SALES_USER, SALES_PIN);
    await navigateToProjectMap(page, PROJECT_NAME);

    const conflictTile = locatePlotTile(page, CONFLICT_PLOT);
    await expect(conflictTile).toBeVisible({ timeout: 20000 });
    await conflictTile.click();

    const conflictBanner = page.getByTestId('project-map-deal-conflict');
    await expect(conflictBanner).toBeVisible({ timeout: 15000 });
    await expect(conflictBanner).toContainText(/ข้อมูลดีลขัดแย้ง|อ่านอย่างเดียว/i);

    // Must NOT expose writable sales form or save/booking actions
    await expect(page.getByRole('button', { name: /บันทึกข้อมูล|บันทึกสถานะ|ยืนยันการจอง/i })).toHaveCount(0);
    await expect(page.getByTestId('project-map-rental-panel')).toHaveCount(0);
  });

  test('7. Vacant plot with New/Follow Up/Appointment interested lead stays available for booking', async ({ page }) => {
    assertSafeNonProdEnv(false);
    requireVars({
      E2E_SALES_USERNAME: SALES_USER,
      E2E_SALES_PIN: SALES_PIN,
      E2E_PROJECT_NAME: PROJECT_NAME,
      E2E_INQUIRY_VACANT_PLOT_NAME: INQUIRY_VACANT_PLOT,
    });

    await signIn(page, SALES_USER, SALES_PIN);
    await navigateToProjectMap(page, PROJECT_NAME);

    const vacantInquiryTile = locatePlotTile(page, INQUIRY_VACANT_PLOT);
    await expect(vacantInquiryTile).toBeVisible({ timeout: 20000 });
    await vacantInquiryTile.click();

    // Must remain available (not blocked as booked, rented, or conflict)
    await expect(page.getByTestId('occupied-restricted-panel')).toHaveCount(0);
    await expect(page.getByTestId('project-map-deal-conflict')).toHaveCount(0);
    await expect(page.getByTestId('project-map-rental-panel')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /จองแปลง|บันทึกการจอง|จองเช่า|ทำสัญญาเช่า/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test('8. Secondary Sales user clicking an RLS-restricted occupied plot sees restricted notice without booking form', async ({ page }) => {
    assertSafeNonProdEnv(false);
    requireVars({
      E2E_SALES2_USERNAME: SALES2_USER,
      E2E_SALES2_PIN: SALES2_PIN,
      E2E_PROJECT_NAME: PROJECT_NAME,
      E2E_RESTRICTED_PLOT_NAME: RESTRICTED_PLOT,
    });

    await signIn(page, SALES2_USER, SALES2_PIN);
    await navigateToProjectMap(page, PROJECT_NAME);

    const restrictedPlot = locatePlotTile(page, RESTRICTED_PLOT);
    await expect(restrictedPlot).toBeVisible({ timeout: 20000 });
    await restrictedPlot.click();

    await expect(page.getByTestId('occupied-restricted-panel')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /บันทึกการจอง/ })).toHaveCount(0);
  });
});

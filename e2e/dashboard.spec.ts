import { test, expect } from '@playwright/test';

test.describe('BuildTrack Dashboard E2E', () => {
  test('User can log in and view the dashboard', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');

    // Wait for the login screen to appear
    await expect(page.locator('text=BuildTrack')).toBeVisible();

    // Select the first user from the dropdown (excluding the disabled placeholder)
    const usernameSelect = page.locator('select#username-select');
    
    // Select Admin user
    await usernameSelect.selectOption('Admin');

    // Enter PIN for Admin
    await page.fill('input#pin-input', '7839');

    // Click Login
    await page.click('button:has-text("Sign In")');

    // Wait longer for Next.js to compile on first load
    await expect(page.locator('text=Projects Overview').first()).toBeVisible({ timeout: 30000 });
    
    // Verify that the dashboard is visible
    await expect(page.locator('text=Projects Overview').first()).toBeVisible({ timeout: 30000 });
  });
});

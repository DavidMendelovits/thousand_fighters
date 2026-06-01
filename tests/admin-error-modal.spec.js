import { expect, test } from '@playwright/test';

test.describe('Error detail modal', () => {
  let characterId;

  // Draft creation uses the text model which can be slow — share one draft across tests
  test.beforeAll(async ({ request }, testInfo) => {
    testInfo.setTimeout(180_000);
    characterId = `pw_errmodal_${testInfo.project.name}_${Date.now()}`
      .replace(/[^a-z0-9_]+/gi, '_')
      .toLowerCase();

    const draftResponse = await request.post('/api/tools/create_character_draft', {
      data: {
        characterId,
        brief: 'A Playwright test fighter for error modal validation.',
      },
      timeout: 180_000,
    });
    expect(draftResponse.ok()).toBeTruthy();
  });

  test('error modal DOM structure exists and is initially hidden', async ({ page }) => {
    await page.goto(`/roster/${characterId}`);
    const modal = page.locator('#error-modal');
    await expect(modal).toBeHidden();
    await expect(modal).toHaveAttribute('role', 'dialog');
    await expect(modal).toHaveAttribute('aria-modal', 'true');
  });

  test('triggering an error opens the modal from the run log', async ({ page }) => {
    await page.goto(`/roster/${characterId}`);

    // Wait for workbench to load
    const workbench = page.locator('#character-workbench');
    await expect(workbench.locator('.character-summary')).toBeVisible();

    // Expand Dev Tools to access the Normalize button
    const devTools = page.locator('details.dev-tools-panel');
    await devTools.locator('summary').click();
    await expect(devTools).toHaveAttribute('open', '');

    // Click Normalize without a source asset — this will log an error
    await page.locator('#normalize-pack').click();

    // The run log should now contain an error line
    const runLog = page.locator('#run-log');
    await expect(runLog.locator('.run-log-error-line').first()).toBeVisible({ timeout: 10000 });

    // Click the error line to open the modal
    await runLog.locator('.run-log-error-line').first().click();

    // Verify the modal is visible
    const modal = page.locator('#error-modal');
    await expect(modal).not.toBeHidden();

    // Verify modal content structure
    await expect(modal.locator('.error-modal-title')).toBeVisible();
    await expect(modal.locator('.error-modal-status')).toBeVisible();
    await expect(modal.locator('.error-modal-status')).toHaveClass(/error-modal-status-error/);

    // Verify error text is present
    await expect(modal.locator('.error-modal-pre-error')).toBeVisible();

    // Verify the "Diagnose with Codex" button exists
    await expect(modal.locator('.error-modal-diagnose')).toBeVisible();
    await expect(modal.locator('.error-modal-diagnose')).toHaveText('Diagnose with Codex');
  });

  test('close button dismisses the modal', async ({ page }) => {
    await page.goto(`/roster/${characterId}`);

    const workbench = page.locator('#character-workbench');
    await expect(workbench.locator('.character-summary')).toBeVisible();

    // Expand Dev Tools and trigger an error
    await page.locator('details.dev-tools-panel summary').click();
    await page.locator('#normalize-pack').click();

    const runLog = page.locator('#run-log');
    await expect(runLog.locator('.run-log-error-line').first()).toBeVisible({ timeout: 10000 });
    await runLog.locator('.run-log-error-line').first().click();

    const modal = page.locator('#error-modal');
    await expect(modal).not.toBeHidden();

    // Close via the X button
    await modal.locator('.error-modal-close').click();
    await expect(modal).toBeHidden();
  });

  test('Escape key dismisses the modal', async ({ page }) => {
    await page.goto(`/roster/${characterId}`);

    const workbench = page.locator('#character-workbench');
    await expect(workbench.locator('.character-summary')).toBeVisible();

    // Expand Dev Tools and trigger an error
    await page.locator('details.dev-tools-panel summary').click();
    await page.locator('#normalize-pack').click();

    const runLog = page.locator('#run-log');
    await expect(runLog.locator('.run-log-error-line').first()).toBeVisible({ timeout: 10000 });
    await runLog.locator('.run-log-error-line').first().click();

    const modal = page.locator('#error-modal');
    await expect(modal).not.toBeHidden();

    // Press Escape
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
  });

  test('clicking the backdrop dismisses the modal', async ({ page }) => {
    await page.goto(`/roster/${characterId}`);

    const workbench = page.locator('#character-workbench');
    await expect(workbench.locator('.character-summary')).toBeVisible();

    // Expand Dev Tools and trigger an error
    await page.locator('details.dev-tools-panel summary').click();
    await page.locator('#normalize-pack').click();

    const runLog = page.locator('#run-log');
    await expect(runLog.locator('.run-log-error-line').first()).toBeVisible({ timeout: 10000 });
    await runLog.locator('.run-log-error-line').first().click();

    const modal = page.locator('#error-modal');
    await expect(modal).not.toBeHidden();

    // Click the backdrop (the modal overlay itself, not the inner box)
    // The modal is position:fixed covering the viewport; click a corner
    // where the inner .error-modal-box won't be
    const box = await modal.boundingBox();
    if (box) {
      await page.mouse.click(box.x + 5, box.y + 5);
    }
    await expect(modal).toBeHidden();
  });

  test('error modal shows tool name from run-log error', async ({ page }) => {
    await page.goto(`/roster/${characterId}`);

    const workbench = page.locator('#character-workbench');
    await expect(workbench.locator('.character-summary')).toBeVisible();

    // Expand Dev Tools and trigger an error
    await page.locator('details.dev-tools-panel summary').click();
    await page.locator('#normalize-pack').click();

    const runLog = page.locator('#run-log');
    await expect(runLog.locator('.run-log-error-line').first()).toBeVisible({ timeout: 10000 });
    await runLog.locator('.run-log-error-line').first().click();

    const modal = page.locator('#error-modal');
    await expect(modal).not.toBeHidden();

    // The tool name for run-log errors is "run-log"
    await expect(modal.locator('.error-modal-title')).toHaveText('run-log');

    // Status badge should say "error"
    await expect(modal.locator('.error-modal-status')).toContainText('error');
  });
});

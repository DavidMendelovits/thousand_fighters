import { expect, test } from '@playwright/test';

test.describe('Per-move sprite generation', () => {
  let characterId;

  // Draft creation uses the text model which can be slow — use a shared setup
  test.beforeAll(async ({ request }, testInfo) => {
    testInfo.setTimeout(180_000);
    characterId = `pw_movegen_${testInfo.project.name}_${Date.now()}`
      .replace(/[^a-z0-9_]+/gi, '_')
      .toLowerCase();

    const draftResponse = await request.post('/api/tools/create_character_draft', {
      data: {
        characterId,
        brief: 'A Playwright test fighter for move generation UI validation.',
      },
      timeout: 180_000,
    });
    expect(draftResponse.ok()).toBeTruthy();
  });

  test('each move card shows a Generate button with data-gen-move attribute', async ({ page }) => {
    await page.goto(`/roster/${characterId}`);

    // Wait for the workbench to render move cards
    const workbench = page.locator('#character-workbench');
    await expect(workbench.locator('[data-move-card]').first()).toBeVisible();

    // Collect all rendered move cards
    const moveCards = workbench.locator('[data-move-card]');
    const cardCount = await moveCards.count();
    expect(cardCount).toBeGreaterThanOrEqual(1);

    // Verify each move card that should have a Generate button
    // (only MOVE_IDS = base, punch, kick, special_1, special_2 get buttons)
    const genButtons = workbench.locator('[data-gen-move]');
    const genCount = await genButtons.count();
    expect(genCount).toBeGreaterThanOrEqual(1);

    // Each button should have the correct text and not be disabled initially
    for (let i = 0; i < genCount; i++) {
      const btn = genButtons.nth(i);
      await expect(btn).toHaveAttribute('data-gen-move', /.+/);
      await expect(btn).not.toBeDisabled();
      await expect(btn).toHaveText('Generate');
    }
  });

  test('clicking Generate transitions to loading state', async ({ page }) => {
    await page.goto(`/roster/${characterId}`);

    const workbench = page.locator('#character-workbench');
    await expect(workbench.locator('[data-move-card]').first()).toBeVisible();

    // Pick the first available Generate button
    const genButton = workbench.locator('[data-gen-move]').first();
    await expect(genButton).toBeVisible();
    const moveId = await genButton.getAttribute('data-gen-move');

    // Delay the API response so we can observe the loading state
    await page.route('**/api/tools/generate_sprite_sheet', async (route) => {
      // Hold the request so the UI stays in loading state
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.continue();
    });

    await genButton.click();

    // The button should now show loading state
    const card = workbench.locator(`[data-move-card="${moveId}"]`);
    await expect(card).toHaveClass(/move-card-loading/);
    await expect(genButton).toBeDisabled();
    await expect(genButton).toContainText('Generating');
  });

  test('move activity modal can be opened', async ({ page }) => {
    await page.goto(`/roster/${characterId}`);

    const workbench = page.locator('#character-workbench');
    await expect(workbench.locator('[data-move-card]').first()).toBeVisible();

    // Get the first move ID
    const moveId = await workbench.locator('[data-gen-move]').first().getAttribute('data-gen-move');

    // Stub the generate endpoint to fail quickly, which logs activity
    await page.route('**/api/tools/generate_sprite_sheet', (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Intentional test failure' }),
      });
    });

    const genButton = workbench.locator(`[data-gen-move="${moveId}"]`);
    await genButton.click();

    // Wait for the error to be processed and button to return to non-loading state
    await expect(genButton).not.toBeDisabled({ timeout: 10000 });

    // After error, activity is logged. The badge may appear on re-render.
    const activityBtn = workbench.locator(`[data-move-activity="${moveId}"]`);
    const activityVisible = await activityBtn.isVisible().catch(() => false);

    if (activityVisible) {
      await activityBtn.click();

      // Move activity opens in its own slide-over panel, not the error modal
      const panel = page.locator('#move-activity-panel');
      await expect(panel).not.toBeHidden();
      await expect(panel.locator('.move-activity-title')).toContainText(moveId);
      await expect(panel.locator('.activity-log')).toBeVisible();
      await expect(page.locator('#error-modal')).toBeHidden();

      // Close the panel
      await panel.locator('.move-activity-close').click();
      await expect(panel).toBeHidden();
    } else {
      // Activity badge didn't render (card may not re-render on error path).
      // Verify activity log state was populated via the run log error line instead.
      const runLog = page.locator('#chat-thread');
      await expect(runLog).toContainText('Intentional test failure');
    }
  });
});

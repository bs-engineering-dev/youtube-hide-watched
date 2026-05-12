import { test, expect, YOUTUBE_VIDEO_PAGE, dismissConsent, waitForVideos } from './fixtures';

test.describe.configure({ timeout: 120000 });

test('marking a video as watched hides it and shows undo', async ({ page }) => {
  await page.goto(YOUTUBE_VIDEO_PAGE, { waitUntil: 'domcontentloaded' });
  const videosLoaded = await waitForVideos(page);
  if (!videosLoaded) {
    test.skip(true, 'YouTube did not render videos');
    return;
  }

  const markBtns = page.locator('.hw-mark-btn, .hw-mark-btn-short');
  const btnCount = await markBtns.count();
  expect(btnCount).toBeGreaterThan(0);

  await markBtns.first().click();

  await expect(page.locator('.hw-undo-card').first()).toBeVisible({ timeout: 3000 });
  await expect(page.locator('.hw-undo-text').first()).toHaveText('Video hidden');
  await expect(page.locator('.hw-undo-btn').first()).toBeVisible();
});

test('undo restores a marked video', async ({ page }) => {
  await page.goto(YOUTUBE_VIDEO_PAGE, { waitUntil: 'domcontentloaded' });
  const videosLoaded = await waitForVideos(page);
  if (!videosLoaded) {
    test.skip(true, 'YouTube did not render videos');
    return;
  }

  const markBtns = page.locator('.hw-mark-btn, .hw-mark-btn-short');
  expect(await markBtns.count()).toBeGreaterThan(0);

  const countBefore = await markBtns.count();
  await markBtns.first().click();
  await expect(page.locator('.hw-undo-card').first()).toBeVisible({ timeout: 3000 });

  await page.locator('.hw-undo-btn').first().click();

  await expect(page.locator('.hw-undo-card')).toHaveCount(0, { timeout: 3000 });
  const countAfter = await page.locator('.hw-mark-btn, .hw-mark-btn-short').count();
  expect(countAfter).toBe(countBefore);
});

test('marking all videos hides them all', async ({ page }) => {
  await page.goto(YOUTUBE_VIDEO_PAGE, { waitUntil: 'domcontentloaded' });
  const videosLoaded = await waitForVideos(page);
  if (!videosLoaded) {
    test.skip(true, 'YouTube did not render videos');
    return;
  }

  const initialMarkBtns = await page.locator('.hw-mark-btn, .hw-mark-btn-short').count();
  expect(initialMarkBtns).toBeGreaterThan(0);

  // Click all mark buttons to trigger individual mark-as-watched
  const markedCount = await page.evaluate(() => {
    let count = 0;
    document.querySelectorAll('.hw-mark-btn, .hw-mark-btn-short').forEach(btn => {
      (btn as HTMLButtonElement).click();
      count++;
    });
    return count;
  });

  expect(markedCount).toBeGreaterThan(0);

  await page.waitForTimeout(500);

  const remainingMarkBtns = await page.locator('.hw-mark-btn, .hw-mark-btn-short').count();
  expect(remainingMarkBtns).toBe(0);

  // Videos are in manual-hide state (undo cards visible) before transitioning to hw-hidden
  const manualHideCount = await page.locator('.hw-manual-hide').count();
  expect(manualHideCount).toBe(markedCount);
});

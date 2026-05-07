import { test, expect, YOUTUBE_VIDEO_PAGE, dismissConsent, waitForVideos } from './fixtures';

test('content script injects on youtube channel page', async ({ page }) => {
  await page.goto(YOUTUBE_VIDEO_PAGE, { waitUntil: 'domcontentloaded' });
  const videosLoaded = await waitForVideos(page);
  if (!videosLoaded) {
    test.skip(true, 'YouTube did not render videos');
    return;
  }

  const hasContentScript = await page.evaluate(() => {
    return document.querySelectorAll('.hw-hidden, .hw-mark-btn, .hw-mark-btn-short').length > 0;
  });
  expect(hasContentScript).toBe(true);
});

test('content script does not inject on youtube watch page', async ({ page }) => {
  await page.goto('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { waitUntil: 'domcontentloaded' });
  await dismissConsent(page);
  await page.waitForTimeout(3000);

  const hiddenCount = await page.locator('.hw-hidden').count();
  const markBtnCount = await page.locator('.hw-mark-btn').count();
  expect(hiddenCount).toBe(0);
  expect(markBtnCount).toBe(0);
});

test('mark button appears on unwatched video thumbnails', async ({ page }) => {
  await page.goto(YOUTUBE_VIDEO_PAGE, { waitUntil: 'domcontentloaded' });
  const videosLoaded = await waitForVideos(page);
  if (!videosLoaded) {
    test.skip(true, 'YouTube did not render videos');
    return;
  }

  const markButtons = page.locator('.hw-mark-btn, .hw-mark-btn-short');
  const count = await markButtons.count();
  expect(count).toBeGreaterThan(0);
  await expect(markButtons.first()).toBeVisible();
});

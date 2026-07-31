import { test, expect, getI18nMessage } from './fixtures';

test('toggle persists enabled state to storage', async ({ context, extensionId }) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  const toggle = popup.locator('#toggle');
  await expect(toggle).toBeChecked();

  // Checkbox is visually hidden (opacity:0) behind the custom switch — click the label
  await popup.locator('.switch').click();
  await expect(toggle).not.toBeChecked();

  // Reload popup and verify state persisted
  await popup.reload();
  await expect(popup.locator('#toggle')).not.toBeChecked();

  // Re-enable
  await popup.locator('.switch').click();
  await popup.reload();
  await expect(popup.locator('#toggle')).toBeChecked();
});

test('mark all shows localized "No videos found" on non-youtube page', async ({ context, extensionId }) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  const noVideos = await getI18nMessage(popup, 'noVideosFound');
  const btn = popup.locator('#markAll');
  await btn.click();

  await expect(btn).toHaveText(noVideos);
  await expect(btn).toBeDisabled();
});

test('threshold slider updates display', async ({ context, extensionId }) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  const slider = popup.locator('#threshold');
  const display = popup.locator('#threshold-display');

  await expect(display).toHaveText('15%');

  await slider.fill('50');
  await slider.dispatchEvent('input');
  await expect(display).toHaveText('50%');
});

test('max age slider updates display', async ({ context, extensionId }) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  const slider = popup.locator('#maxAgeDays');
  const display = popup.locator('#maxage-display');

  const off = await getI18nMessage(popup, 'maxAgeOff');
  const day1 = await getI18nMessage(popup, 'maxAgeDays', ['1', await getI18nMessage(popup, 'dayUnit')]);
  const day7 = await getI18nMessage(popup, 'maxAgeDays', ['7', await getI18nMessage(popup, 'daysUnit')]);

  await expect(display).toHaveText(off);

  await slider.fill('7');
  await slider.dispatchEvent('input');
  await expect(display).toHaveText(day7);

  await slider.fill('1');
  await slider.dispatchEvent('input');
  await expect(display).toHaveText(day1);

  await slider.fill('0');
  await slider.dispatchEvent('input');
  await expect(display).toHaveText(off);
});

test('hidden count shows in popup when videos are hidden', async ({ context, extensionId }) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  const hiddenCount = popup.locator('#hidden-count');
  await expect(hiddenCount).toBeAttached();
  // On a non-YouTube page, the count should be empty (no content script to respond)
  await expect(hiddenCount).toHaveText('');
});

test('clear cache resets count', async ({ context, extensionId }) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  const cached = await getI18nMessage(popup, 'videosCached', ['0', await getI18nMessage(popup, 'videosUnit')]);
  const cleared = await getI18nMessage(popup, 'cacheCleared');

  await expect(popup.locator('#cache-count')).toHaveText(cached);
  await popup.locator('#clear-cache').click();
  await expect(popup.locator('#status')).toHaveText(cleared);
});

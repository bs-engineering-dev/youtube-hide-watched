import { test, expect } from './fixtures';

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

test('mark all shows "No videos found" on non-youtube page', async ({ context, extensionId }) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  const btn = popup.locator('#markAll');
  await btn.click();

  await expect(btn).toHaveText('No videos found');
  await expect(btn).toBeDisabled();
});

test('options threshold slider updates display', async ({ context, extensionId }) => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);

  const slider = options.locator('#threshold');
  const display = options.locator('#threshold-display');

  await expect(display).toHaveText('1%');

  await slider.fill('50');
  await slider.dispatchEvent('input');
  await expect(display).toHaveText('50%');
});

test('options clear cache resets count', async ({ context, extensionId }) => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);

  await expect(options.locator('#cache-count')).toHaveText('0 videos cached');
  await options.locator('#clear-cache').click();
  await expect(options.locator('#status')).toHaveText('Cache cleared');
});

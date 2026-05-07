import { test, expect } from './fixtures';

test('extension service worker starts', async ({ extensionId }) => {
  expect(extensionId).toBeTruthy();
});

test('popup renders with toggle and mark all button', async ({ context, extensionId }) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  await expect(popup.locator('.header')).toHaveText('Hide Watched');
  await expect(popup.locator('.switch')).toBeVisible();
  await expect(popup.locator('#toggle')).toBeAttached();
  await expect(popup.locator('#markAll')).toBeVisible();
  await expect(popup.locator('#markAll')).toHaveText('Mark All Watched');
  await expect(popup.locator('#options')).toHaveText('Settings');
});

test('options page renders with all controls', async ({ context, extensionId }) => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);

  await expect(options.locator('#threshold')).toBeVisible();
  await expect(options.locator('#hideMostRelevant')).toBeVisible();
  await expect(options.locator('#clear-cache')).toBeVisible();
  await expect(options.locator('#cache-count')).toHaveText('0 videos cached');
});

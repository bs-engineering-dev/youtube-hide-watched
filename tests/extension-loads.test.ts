import { test, expect } from './fixtures';

test('extension service worker starts', async ({ extensionId }) => {
  expect(extensionId).toBeTruthy();
});

test('popup renders with all controls', async ({ context, extensionId }) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  await expect(popup.locator('.header')).toHaveText('Hide Watched YouTube Videos');
  await expect(popup.locator('.switch')).toBeVisible();
  await expect(popup.locator('#toggle')).toBeAttached();
  await expect(popup.locator('#markAll')).toBeVisible();
  await expect(popup.locator('#markAll')).toHaveText('Mark All Watched');
  await expect(popup.locator('#threshold')).toBeVisible();
  await expect(popup.locator('#hideMostRelevant')).toBeAttached();
  await expect(popup.locator('#clear-cache')).toBeVisible();
  await expect(popup.locator('#cache-count')).toHaveText('0 videos cached');
  await expect(popup.locator('#hidden-count')).toBeAttached();
});

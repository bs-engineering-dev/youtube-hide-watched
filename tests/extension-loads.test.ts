import { test, expect, getI18nMessage } from './fixtures';

test('extension service worker starts', async ({ extensionId }) => {
  expect(extensionId).toBeTruthy();
});

test('popup renders with all controls', async ({ context, extensionId }) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  const extName = await getI18nMessage(popup, 'extName');
  const markAll = await getI18nMessage(popup, 'markAllWatched');
  const cached = await getI18nMessage(popup, 'videosCached', ['0', 'videos']);

  await expect(popup.locator('.header')).toHaveText(extName);
  await expect(popup.locator('.switch')).toBeVisible();
  await expect(popup.locator('#toggle')).toBeAttached();
  await expect(popup.locator('#markAll')).toBeVisible();
  await expect(popup.locator('#markAll')).toHaveText(markAll);
  await expect(popup.locator('#threshold')).toBeVisible();
  await expect(popup.locator('#hideMostRelevant')).toBeAttached();
  await expect(popup.locator('#clear-cache')).toBeVisible();
  await expect(popup.locator('#cache-count')).toHaveText(cached);
  await expect(popup.locator('#hidden-count')).toBeAttached();
});

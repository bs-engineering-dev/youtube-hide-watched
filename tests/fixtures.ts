import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';

const EXTENSION_PATH = path.resolve(__dirname, '..');

type Fixtures = {
  context: BrowserContext;
  extensionId: string;
  page: Page;
};

export const test = base.extend<Fixtures>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--disable-gpu',
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker');
    }
    const id = background.url().split('/')[2];
    await use(id);
  },
  page: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
  },
});

export { expect } from '@playwright/test';

// Fresh profiles get an empty home page ("Try searching to get started").
// Channel pages always render videos regardless of sign-in state.
export const YOUTUBE_VIDEO_PAGE = 'https://www.youtube.com/@MrBeast/videos';

export async function dismissConsent(page: Page) {
  try {
    const btn = page.locator('button:has-text("Reject all"), button:has-text("Reject the use"), button:has-text("Confirm")');
    await btn.first().click({ timeout: 3000 });
  } catch {}
}

export async function waitForVideos(page: Page): Promise<boolean> {
  await dismissConsent(page);
  try {
    await page.waitForSelector(
      'ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer',
      { timeout: 15000 }
    );
    await page.waitForTimeout(2000);
    return true;
  } catch {
    return false;
  }
}

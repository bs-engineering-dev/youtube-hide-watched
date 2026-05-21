import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

const localesDir = resolve(__dirname, '..', '_locales');
const localeDirs = readdirSync(localesDir).filter(d => {
  try { return readFileSync(join(localesDir, d, 'messages.json'), 'utf-8'); }
  catch { return false; }
});

const enMessages = JSON.parse(readFileSync(join(localesDir, 'en', 'messages.json'), 'utf-8'));
const enKeys = Object.keys(enMessages).sort();

test('all locale files are valid JSON with matching keys', () => {
  expect(localeDirs.length).toBeGreaterThanOrEqual(14);

  for (const locale of localeDirs) {
    const filePath = join(localesDir, locale, 'messages.json');
    const raw = readFileSync(filePath, 'utf-8');
    let messages: Record<string, unknown>;
    try {
      messages = JSON.parse(raw);
    } catch (e) {
      throw new Error(`${locale}/messages.json is not valid JSON: ${e}`);
    }

    const keys = Object.keys(messages).sort();
    expect(keys, `${locale} has wrong keys`).toEqual(enKeys);
  }
});

test('all locale messages have non-empty message fields', () => {
  for (const locale of localeDirs) {
    const filePath = join(localesDir, locale, 'messages.json');
    const messages = JSON.parse(readFileSync(filePath, 'utf-8'));

    for (const [key, entry] of Object.entries(messages) as [string, { message: string }][]) {
      expect(entry.message, `${locale}/${key} has empty message`).toBeTruthy();
    }
  }
});

test('all locale messages preserve placeholders from English', () => {
  for (const locale of localeDirs) {
    if (locale === 'en') continue;
    const filePath = join(localesDir, locale, 'messages.json');
    const messages = JSON.parse(readFileSync(filePath, 'utf-8'));

    for (const [key, enEntry] of Object.entries(enMessages) as [string, { placeholders?: Record<string, unknown> }][]) {
      if (!enEntry.placeholders) continue;
      const localeEntry = messages[key] as { placeholders?: Record<string, unknown> };
      expect(localeEntry.placeholders, `${locale}/${key} missing placeholders`).toBeDefined();
      expect(
        Object.keys(localeEntry.placeholders!).sort(),
        `${locale}/${key} has wrong placeholder keys`
      ).toEqual(Object.keys(enEntry.placeholders).sort());
    }
  }
});

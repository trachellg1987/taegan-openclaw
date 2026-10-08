'use strict';

/**
 * ClassLink SSO login helper.
 *
 * Used by both Canvas and Skyward scrapers. Navigates to the ClassLink portal,
 * fills credentials, submits, and waits for the app launcher dashboard to load.
 *
 * After this function resolves, `page` is authenticated and on the ClassLink
 * dashboard — ready for navigateToApp().
 *
 * NOTE ON SELECTORS: ClassLink districts can customize their login page.
 * If login fails, inspect the page with Playwright's codegen:
 *   npx playwright codegen $CLASSLINK_URL
 * and update the selectors below to match.
 */

const { chromium } = require('playwright');
const { getConfig } = require('../config');

/**
 * Launch a Chromium browser and log into ClassLink.
 * Returns { browser, page } — caller must call browser.close() when done.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.headless=true]  Run headless. Set false to debug.
 */
async function launchAndLogin(opts = {}) {
  const config = getConfig();
  const { classlink_url, classlink_user, classlink_pass } = config.env;

  if (!classlink_url || !classlink_user || !classlink_pass) {
    throw new Error(
      'ClassLink credentials not set. Fill in CLASSLINK_URL, CLASSLINK_USER, CLASSLINK_PASS in .env'
    );
  }

  const browser = await chromium.launch({ headless: opts.headless !== false });
  const page = await browser.newPage();

  await loginViaClassLink(page, { classlink_url, classlink_user, classlink_pass });
  return { browser, page };
}

/**
 * Perform ClassLink login on an existing page.
 * Exported separately for testing with a mock page.
 */
async function loginViaClassLink(page, creds) {
  const { classlink_url, classlink_user, classlink_pass } = creds;

  await page.goto(classlink_url, { waitUntil: 'domcontentloaded' });

  // Fill username
  // ADJUST SELECTOR: inspect the login form if this doesn't match
  await page.fill('input[name="username"], input[type="text"]#username, input[id="username"]', classlink_user);

  // Fill password
  await page.fill('input[name="password"], input[type="password"]', classlink_pass);

  // Submit
  // PFISD's Sign In is <button type="button" id="signin">, not a submit button
  await page.click('#signin, button[type="submit"], input[type="submit"]');

  // Wait for app launcher to confirm login succeeded
  // ADJUST SELECTOR: the ClassLink dashboard typically has an app grid or header
  await page.waitForSelector(
    '.app-icon, [class*="appLauncher"], [class*="app-launcher"], #appContainer, .applications',
    { timeout: 20_000 }
  );
}

/**
 * Click on a named app tile in the ClassLink launcher and wait for it to open.
 * Returns the new page/tab that the app opens in.
 *
 * @param {Page}   page     - Authenticated ClassLink page
 * @param {string} appName  - Visible label of the tile, e.g. "Canvas" or "Skyward PFISD"
 */
async function navigateToApp(page, appName) {
  // App tiles in ClassLink are usually <a> or <div> elements containing the app name.
  // ADJUST SELECTOR: use Playwright codegen to capture the exact structure for your district.
  const appTile = page.locator(
    `[class*="app"] >> text="${appName}", a:has-text("${appName}"), div:has-text("${appName}")`
  ).first();

  // ClassLink may open the app in a new tab
  const [newPage] = await Promise.all([
    page.context().waitForEvent('page', { timeout: 15_000 }).catch(() => null),
    appTile.click(),
  ]);

  const target = newPage || page;
  await target.waitForLoadState('domcontentloaded');
  return target;
}

/**
 * Navigate to Savvas (English assignment portal) from the ClassLink launcher.
 *
 * Savvas is known by different tile labels across districts:
 *   "Savvas Realize", "Savvas", "Savvas Learning Platform", "Pearson Realize"
 *
 * This function tries each label in order and returns the first match.
 * After this resolves, the returned page is on the Savvas dashboard and
 * ready for scraping English assignments.
 *
 * ADJUST: if the tile is named differently, update SAVVAS_TILE_NAMES below or
 * use Playwright codegen to find the exact label:
 *   npx playwright codegen $CLASSLINK_URL
 *
 * @param {Page} page  - Authenticated ClassLink page
 * @returns {Page}       The Savvas page (may be a new tab)
 */
const SAVVAS_TILE_NAMES = [
  'Savvas Realize',
  'Savvas',
  'Savvas Learning Platform',
  'Pearson Realize',
];

async function navigateToSavvas(page) {
  let lastErr;
  for (const name of SAVVAS_TILE_NAMES) {
    try {
      // Check if the tile is present before clicking (avoids full timeout wait)
      const tile = page.locator(
        `[class*="app"] >> text="${name}", a:has-text("${name}"), div:has-text("${name}")`
      ).first();
      const count = await tile.count();
      if (count === 0) continue;

      const savvasPage = await navigateToApp(page, name);
      // Wait for Savvas Realize dashboard to confirm load
      // ADJUST SELECTOR: Savvas Realize typically loads a .course-tile or #dashboard element
      await savvasPage.waitForSelector(
        '.course-tile, .dashboard, #dashboard, [class*="course"], [class*="program"]',
        { timeout: 20_000 }
      ).catch(() => { /* page loaded but selector not found — still usable */ });
      return savvasPage;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `Could not find Savvas tile in ClassLink. Tried: ${SAVVAS_TILE_NAMES.join(', ')}. ` +
    'Use Playwright codegen to find the correct tile label: ' +
    'npx playwright codegen $CLASSLINK_URL'
  );
}

module.exports = { launchAndLogin, loginViaClassLink, navigateToApp, navigateToSavvas, SAVVAS_TILE_NAMES };

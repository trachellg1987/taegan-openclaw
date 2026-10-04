'use strict';

/**
 * DC-002: Skyward PFISD Grade + Missing Assignment Scraper
 *
 * Logs into ClassLink, navigates to Skyward PFISD, scrapes current grades and
 * any missing assignments, and writes to ~/.openclaw/workspace/skyward-data.json.
 *
 * Output shape:
 * {
 *   scrapedAt: "ISO string",
 *   grades: [
 *     { course: string, grade: string, percent: number | null }
 *   ],
 *   missing: [
 *     { name: string, course: string, dueDate: string | null }
 *   ]
 * }
 *
 * NOTE ON SELECTORS: Skyward's web UI varies significantly between districts
 * and school year versions. If scraping breaks, run:
 *   npx playwright codegen <your-skyward-url>
 * and update selectors marked ADJUST SELECTOR below.
 */

const fs = require('fs');
const path = require('path');
const { launchAndLogin, navigateToApp } = require('./classlink');

const OUTPUT_FILE = path.join(
  process.env.HOME, '.openclaw', 'workspace', 'skyward-data.json'
);

async function scrapeSkyward() {
  const { browser, page } = await launchAndLogin();

  try {
    const skywardPage = await navigateToApp(page, 'Skyward PFISD');

    // Wait for Skyward to fully load — it uses a frameset or SPA
    // ADJUST SELECTOR: Skyward often loads a frameset; the main content area varies
    await skywardPage.waitForSelector(
      'frameset, frame, #skywardPortal, .skyward-main, table.DataGrid',
      { timeout: 25_000 }
    );

    // Skyward frequently uses iframes — switch into the content frame if present
    const frames = skywardPage.frames();
    const contentFrame = frames.find(f =>
      f.url().includes('sfgradebook') ||
      f.url().includes('gradebook') ||
      f.url().includes('StudentGrade') ||
      f.url().includes('gradebookSummary')
    ) || skywardPage;

    // Navigate to Family Access / Gradebook view
    // ADJUST SELECTOR: Skyward menu link text varies — look for "Gradebook" or "Grade"
    const gradebookLink = contentFrame.locator(
      'a:has-text("Gradebook"), a:has-text("Grade"), a:has-text("Academic History"), ' +
      '[id*="gradebook"], [class*="gradebook"]'
    ).first();

    if (await gradebookLink.count() > 0) {
      await gradebookLink.click();
      await contentFrame.waitForLoadState('domcontentloaded');
    }

    const [grades, missing] = await Promise.all([
      scrapeGrades(contentFrame),
      scrapeMissing(contentFrame),
    ]);

    const output = {
      scrapedAt: new Date().toISOString(),
      grades,
      missing,
    };

    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    return output;
  } finally {
    await browser.close();
  }
}

async function scrapeGrades(frame) {
  return frame.evaluate(() => {
    const grades = [];

    // Skyward grade rows: each class is a row in a summary table
    // ADJUST SELECTOR: Skyward uses .DataGrid or table with class-specific rows
    const rows = document.querySelectorAll(
      'table.DataGrid tr[class*="DataGridItem"], ' +
      'tr.sf_GridRow, tr[class*="Row"]:not([class*="Header"])'
    );

    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 2) return;

      // ADJUST: column order varies — typically course name is col 0-1, grade col 2-4
      const courseEl = cells[0] || cells[1];
      const gradeEl = [...cells].find(c =>
        /^[A-F][+-]?$/.test(c.textContent.trim()) ||
        /^\d{1,3}(\.\d+)?%?$/.test(c.textContent.trim())
      );
      const percentEl = [...cells].find(c =>
        /^\d{1,3}(\.\d+)?%$/.test(c.textContent.trim())
      );

      if (!courseEl || !gradeEl) return;

      const percentText = (percentEl?.textContent || '').replace('%', '').trim();
      const percent = percentText ? parseFloat(percentText) : null;

      grades.push({
        course: courseEl.textContent.trim(),
        grade: gradeEl.textContent.trim(),
        percent: isNaN(percent) ? null : percent,
      });
    });

    return grades;
  });
}

async function scrapeMissing(frame) {
  return frame.evaluate(() => {
    const missing = [];

    // Skyward missing assignment indicators vary by version.
    // Common patterns: rows with "Missing" label, zero-score rows, or explicit missing flag.
    // ADJUST SELECTOR: look for "Missing" text near assignment rows
    document.querySelectorAll(
      'tr:has(td:contains("Missing")), ' +
      '[class*="missing"], ' +
      'td.Missing, ' +
      'span:has-text("Missing")'
    ).forEach(el => {
      // Walk up to the containing row to extract assignment details
      const row = el.closest('tr') || el;
      const cells = row.querySelectorAll('td');
      if (cells.length < 1) return;

      // ADJUST: column order for assignment name, course, due date
      const nameEl = cells[0] || cells[1];
      const courseEl = cells[1] || cells[2];
      const dueDateEl = [...cells].find(c =>
        /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(c.textContent)
      );

      if (!nameEl || !nameEl.textContent.trim()) return;

      const rawDate = dueDateEl?.textContent.trim() || null;
      let dueDate = rawDate;
      // Normalize M/D/YYYY → YYYY-MM-DD if possible
      if (rawDate && /\d{1,2}\/\d{1,2}\/\d{4}/.test(rawDate)) {
        const [m, d, y] = rawDate.split('/');
        dueDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      }

      missing.push({
        name: nameEl.textContent.trim(),
        course: courseEl?.textContent.trim() || 'Unknown',
        dueDate,
      });
    });

    return missing;
  });
}

module.exports = { scrapeSkyward, scrapeGrades, scrapeMissing };

'use strict';

/**
 * DC-001: Canvas Assignment Scraper
 *
 * Logs into ClassLink, navigates to Canvas, scrapes all upcoming and missing
 * assignments, and writes to ~/.openclaw/workspace/canvas-data.json.
 *
 * Output shape:
 * {
 *   scrapedAt: "ISO string",
 *   assignments: [
 *     {
 *       name:      string,
 *       course:    string,
 *       dueDate:   string (ISO) | null,
 *       submitted: boolean,
 *       status:    "submitted" | "not_submitted" | "graded" | "missing"
 *     }
 *   ]
 * }
 *
 * NOTE ON SELECTORS: Canvas's DOM is fairly consistent across districts but
 * SSO integrations can vary. If scraping breaks, run:
 *   npx playwright codegen <your-canvas-url>
 * and update selectors marked ADJUST SELECTOR below.
 */

const fs = require('fs');
const path = require('path');
const { launchAndLogin, navigateToApp } = require('./classlink');

const OUTPUT_FILE = path.join(
  process.env.HOME, '.openclaw', 'workspace', 'canvas-data.json'
);

async function scrapeCanvas() {
  const { browser, page } = await launchAndLogin();

  try {
    const canvasPage = await navigateToApp(page, 'Canvas');

    // Wait for Canvas dashboard to fully load
    // ADJUST SELECTOR: Canvas dashboard has #dashboard or .ic-Dashboard-header
    await canvasPage.waitForSelector('#dashboard, .ic-Dashboard-header, .dashboard-header', {
      timeout: 20_000,
    });

    const assignments = await scrapeAssignments(canvasPage);

    const output = {
      scrapedAt: new Date().toISOString(),
      assignments,
    };

    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    return output;
  } finally {
    await browser.close();
  }
}

async function scrapeAssignments(page) {
  // Navigate to the "Grades" summary page which lists all assignments across courses.
  // This is more reliable than scraping course-by-course.
  // ADJUST SELECTOR: Canvas grade summary path may vary
  const canvasBase = new URL(page.url()).origin;
  await page.goto(`${canvasBase}/grades`, { waitUntil: 'networkidle' });

  // Wait for the grades table to appear
  // ADJUST SELECTOR: Canvas grades page uses .student_assignment or table rows
  await page.waitForSelector(
    '.student_assignment, .assignment-name, table.ic-Table tr[class*="assignment"]',
    { timeout: 15_000 }
  ).catch(() => {
    // Grades page not available — fall back to To Do list on dashboard
  });

  // Try to scrape from the To Do list on dashboard if grades page didn't work
  const assignments = await page.evaluate(() => {
    const results = [];

    // Strategy 1: Grades summary table rows
    // ADJUST SELECTOR: inspect rows in Canvas gradebook
    document.querySelectorAll('.student_assignment, tr.assignment_graded, tr.assignment').forEach(row => {
      const nameEl = row.querySelector('.title a, .assignment_title, .ig-title');
      const courseEl = row.querySelector('.context, .course_name, .context_name');
      const dueDateEl = row.querySelector('.due_date, .assignment-due-date time, .date_submitted');
      const statusEl = row.querySelector('.status, .grade, .submission_status');

      if (!nameEl) return;

      const statusText = (statusEl?.textContent || '').trim().toLowerCase();
      let status = 'not_submitted';
      if (statusText.includes('submitted') || statusText.includes('turned in')) status = 'submitted';
      else if (statusText.includes('graded') || statusText.includes('grade')) status = 'graded';
      else if (statusText.includes('missing')) status = 'missing';

      results.push({
        name: nameEl.textContent.trim(),
        course: courseEl?.textContent.trim() || 'Unknown',
        dueDate: dueDateEl?.getAttribute('datetime') || dueDateEl?.textContent.trim() || null,
        submitted: status === 'submitted' || status === 'graded',
        status,
      });
    });

    // Strategy 2: To Do / upcoming list items if strategy 1 found nothing
    if (results.length === 0) {
      document.querySelectorAll(
        '.todo-list-item, .planner-item, [class*="todo"] .title, .upcoming_event'
      ).forEach(item => {
        const nameEl = item.querySelector('a, .title, h3');
        const courseEl = item.querySelector('.context, .course-name, .subtitle');
        const dueDateEl = item.querySelector('time, .date, .due_date');

        if (!nameEl) return;

        results.push({
          name: nameEl.textContent.trim(),
          course: courseEl?.textContent.trim() || 'Unknown',
          dueDate: dueDateEl?.getAttribute('datetime') || dueDateEl?.textContent.trim() || null,
          submitted: false,
          status: 'not_submitted',
        });
      });
    }

    return results;
  });

  return assignments;
}

module.exports = { scrapeCanvas, scrapeAssignments };
